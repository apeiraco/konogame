import { FEATURE_PLAN } from "@konogame/infrastructure";
import { Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { CLI_PROMPTS, type CliOptions, type Prompts, runCli } from "../main.ts";

async function invoke(
  args: readonly string[],
  options: { readonly isTTY?: boolean; readonly overrides?: CliOptions["overrides"] } = {}
) {
  let stdout = "";
  let stderr = "";
  const code = await Effect.runPromise(
    runCli([...args], {
      isTTY: options.isTTY ?? false,
      env: {},
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
      overrides: options.overrides
    })
  );
  return { code, stdout, stderr };
}

test("root interaction switches work without a command and before topics", async () => {
  for (const flag of ["--non-interactive", "--interactive=false"]) {
    const result = await invoke([flag]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/usage/i);
    expect(result.stderr).toBe("");
  }
  const result = await invoke(["--json", "workspace", "schema"]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).$schema).toContain("json-schema.org");
  const missing = await invoke(["--json"]);
  expect(missing.code).toBe(1);
  expect(missing.stdout).toBe("");
});

test("terminal menu and missing arguments use injected prompts", async () => {
  const asked: string[] = [];
  const app = {
    plan(features: readonly string[]) {
      return Effect.succeed({ features });
    }
  };
  const prompts: Prompts = {
    text: (message) =>
      Effect.sync(() => {
        asked.push(message);
        return "save.store";
      }),
    select: (message) =>
      Effect.sync(() => {
        asked.push(message);
        return "plan";
      }),
    confirm: () => Effect.die(new Error("Unexpected prompt"))
  };
  const result = await invoke([], {
    isTTY: true,
    overrides: Layer.merge(
      Layer.succeed(FEATURE_PLAN, app as never),
      Layer.succeed(CLI_PROMPTS, prompts)
    )
  });
  expect(result.code).toBe(0);
  expect(asked).toEqual(["Choose a command", "feature"]);
  expect(JSON.parse(result.stdout)).toEqual({ features: ["save.store"] });
  expect(result.stderr).toBe("");
});
