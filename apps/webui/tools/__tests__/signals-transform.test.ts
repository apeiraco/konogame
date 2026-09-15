import { SourceMap } from "node:module";
import { resolve } from "node:path";
import { parseSync } from "oxc-parser";
import { build, createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { signalsTracking, transformSignals } from "../signals-transform.ts";

const sourceRoot = resolve(import.meta.dirname, "../../src");

function transformed(source: string, filename = "App.tsx") {
  const result = transformSignals(source, filename);
  expect(result).not.toBeNull();
  expect(parseSync(filename, result!.code).errors).toEqual([]);
  return result!;
}

test("tracks declarations, typed arrows, wrapper components, fragments and destructured values", () => {
  const result = transformed(`
export function Counter() { const { value } = counter; return <span>{value}</span>; }
export const Arrow = (): React.ReactNode => (<>{counter.value}</>);
export const Wrapped = memo(forwardRef((props, ref) => <span ref={ref}>{counter["value"]}</span>));
export function useCounter() { return counter.value; }
`);
  expect(result.code.match(/_useSignals\(1\)/g)).toHaveLength(3);
  expect(result.code.match(/_useSignals\(2\)/g)).toHaveLength(1);
  expect(result.code.match(/finally/g)).toHaveLength(4);
  expect(transformSignals(result.code, "App.tsx")).toBeNull();
});

test("does not transform ordinary functions, components without reads or hook callbacks", () => {
  expect(
    transformSignals(
      `
function calculate() { return counter.value; }
function Heading() { return <h1>Heading</h1>; }
function Render() {
  useEffect(() => { document.title = counter.value; });
  const onClick = useCallback(() => counter.value++, []);
  return <button onClick={onClick}>Add</button>;
}
`,
      "App.tsx"
    )
  ).toBeNull();
});

test("attributes synchronous array render callbacks to their component and isolates nested components", () => {
  const result = transformed(`
function Parent() {
  function Child() { return <span>{child.value}</span>; }
  return <div>{items.map(item => <span>{item.value}</span>)}<Child /></div>;
}
`);
  expect(result.code.match(/_useSignals\(1\)/g)).toHaveLength(2);
  expect(result.code).not.toMatch(/item\s*=>\s*\{\s*const _signalScope/);
});

test("supports explicit annotations with opt-out taking precedence", () => {
  const result = transformed(`
/** @noUseSignals */
export const Disabled = () => <span>{counter.value}</span>;
/** @trackSignals */
export function useIndirect() { return readIndirectly(); }
/** @useSignals @noTrackSignals */
function Both() { return <span>{counter.value}</span>; }
`);
  expect(result.code.match(/_useSignals\(/g)).toHaveLength(1);
  expect(result.code).toContain("_useSignals(2)");
});

test("avoids source bindings and retains module/function directives and comments", () => {
  const result = transformed(`"use client";
const _useSignals = 42;
function Counter() {
  "use strict";
  const _signalScope = "existing";
  // Keep the original explanation.
  return <span>{counter.value}</span>;
}`);
  expect(result.code.startsWith('"use client";')).toBe(true);
  expect(result.code).toContain("useSignals as _useSignals1");
  expect(result.code).toContain("const _signalScope1 = _useSignals1(1)");
  expect(result.code.indexOf('"use strict"')).toBeLessThan(
    result.code.indexOf("const _signalScope1")
  );
  expect(result.code).toContain("// Keep the original explanation.");
});

test("ends tracking on early returns, thrown errors and nested hook calls", () => {
  const result = transformed(
    `
function useNested() { return signal.value; }
function useCounter(mode) {
  if (mode === "early") return signal.value;
  if (mode === "throw") throw new Error("render failed");
  return useNested();
}
`,
    "hooks.ts"
  );
  const events: string[] = [];
  const track = vi.fn((usage: number) => {
    events.push(`start:${usage}`);
    return { f: () => events.push("finish") };
  });
  // Execute the generated hook bodies with a scoped test boundary in place of React.
  const evaluate = new Function(
    "_useSignals",
    "signal",
    `${result.code.replace(/^import .*$/m, "")}\nreturn useCounter;`
  );
  const useCounter = evaluate(track, { value: 7 }) as (mode: string) => number;
  expect(useCounter("early")).toBe(7);
  expect(events.splice(0)).toEqual(["start:2", "finish"]);
  expect(() => useCounter("throw")).toThrow("render failed");
  expect(events.splice(0)).toEqual(["start:2", "finish"]);
  expect(useCounter("nested")).toBe(7);
  expect(events).toEqual(["start:2", "start:2", "finish", "finish"]);
});

test("preserves source positions after Unicode text and injected cleanup", () => {
  const source = "// 中文 🎮\nexport const Counter = () => (<span>{counter.value}</span>);";
  const result = transformed(source);
  const offset = result.code.indexOf("counter.value");
  const preceding = result.code.slice(0, offset).split("\n");
  const origin = new SourceMap(JSON.parse(result.map.toString())).findOrigin(
    preceding.length,
    preceding.at(-1)!.length + 1
  );
  expect(origin).toMatchObject({
    fileName: "App.tsx",
    lineNumber: 2,
    columnNumber: source.split("\n")[1]!.indexOf("counter.value") + 1
  });
  expect(result.map.sourcesContent).toEqual([source]);
});

describe("Vite integration", () => {
  const filename = resolve(sourceRoot, "signals-fixture.tsx").replaceAll("\\", "/");
  const source = "export function Counter() { return <span>{counter.value}</span>; }";
  let server: ViteDevServer;
  const fixture = {
    name: "signals-test-source",
    resolveId(id: string) {
      if (
        id === "signals-fixture" ||
        id.replaceAll("\\", "/").endsWith("/signals-fixture") ||
        id === "/src/signals-fixture.tsx" ||
        id.replaceAll("\\", "/") === filename
      ) {
        return filename;
      }
    },
    load(id: string) {
      if (id.replaceAll("\\", "/") === filename) {
        return source;
      }
    }
  };

  beforeAll(async () => {
    server = await createServer({
      root: resolve(sourceRoot, ".."),
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      plugins: [signalsTracking(), fixture],
      server: { hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  test("adds tracking before JSX lowering in both client and SSR development transforms", async () => {
    const [client, ssr] = await Promise.all([
      server.transformRequest("/src/signals-fixture.tsx"),
      server.transformRequest("/src/signals-fixture.tsx", { ssr: true })
    ]);
    for (const result of [client, ssr]) {
      expect(result?.code).toContain("useSignals");
      expect(result?.code).toContain("finally");
      expect(result?.code).not.toContain("<span>");
      expect(result?.map && "sourcesContent" in result.map && result.map.sourcesContent).toContain(
        source
      );
    }
  });

  test("skips generated sources, dependencies and raw asset queries", async () => {
    const plugin = server.config.plugins.find(
      (entry) => entry.name === "konogame:signals-tracking"
    )!;
    const hook = plugin.transform;
    const transform = typeof hook === "function" ? hook : hook!.handler;
    for (const id of [
      resolve(sourceRoot, "routeTree.gen.ts"),
      resolve(sourceRoot, "node_modules/dependency.tsx"),
      resolve(sourceRoot, "__tests__/fixture.tsx"),
      `${filename}?raw`,
      `${filename}?url`,
      resolve(sourceRoot, "../tools/fixture.tsx")
    ]) {
      expect(await transform.call({} as never, source, id)).toBeNull();
    }
  });

  test("keeps tracking and original source maps in production output", async () => {
    const result = await build({
      root: resolve(sourceRoot, ".."),
      configFile: false,
      logLevel: "silent",
      plugins: [signalsTracking(), fixture],
      build: {
        write: false,
        minify: false,
        sourcemap: true,
        lib: { entry: "signals-fixture", formats: ["es"] },
        rolldownOptions: { external: ["@preact/signals-react/runtime", "react/jsx-runtime"] }
      }
    });
    const outputs = Array.isArray(result)
      ? result.flatMap((entry) => entry.output)
      : "output" in result
        ? result.output
        : [];
    const chunk = outputs.find((entry) => entry.type === "chunk");
    expect(chunk?.code).toContain("useSignals");
    expect(chunk?.code).toContain("finally");
    expect(chunk?.code).toMatch(/\.f\(\)/);
    expect(chunk?.map?.sourcesContent).toContain(source);
  });

  test("reloads tracked component edits including removal, while leaving unrelated HMR intact", async () => {
    await server.transformRequest("/src/signals-fixture.tsx");
    const plugin = server.config.plugins.find(
      (entry) => entry.name === "konogame:signals-tracking"
    )!;
    const hook = plugin.hotUpdate!;
    const update = typeof hook === "function" ? hook : hook.handler;
    const send = vi.fn();
    const client = { environment: { config: { consumer: "client" }, hot: { send } } } as never;
    const ssr = { environment: { config: { consumer: "server" }, hot: { send } } } as never;
    const trackedEdit = { file: filename } as never;
    expect(
      await update.call(client, { file: resolve(sourceRoot, "untracked.tsx") } as never)
    ).toBeUndefined();
    expect(await update.call(ssr, trackedEdit)).toBeUndefined();
    expect(send).not.toHaveBeenCalled();
    // The previous generation owns the edit decision before the new source is transformed.
    expect(await update.call(client, trackedEdit)).toEqual([]);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "full-reload" });
    const transformHook = plugin.transform!;
    const transform = typeof transformHook === "function" ? transformHook : transformHook.handler;
    expect(
      await transform.call({} as never, "export const Counter = () => <span />;", filename)
    ).toBeNull();
    expect(await update.call(client, trackedEdit)).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
