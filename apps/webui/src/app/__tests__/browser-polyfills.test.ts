import { afterEach, expect, test, vi } from "vitest";
import { bootstrapBrowserApp, ensureBrowserApis } from "../browser-polyfills.ts";

const { temporalPolyfillLoaded } = vi.hoisted(() => ({ temporalPolyfillLoaded: vi.fn() }));

vi.mock("@js-temporal/polyfill", async (importOriginal) => {
  temporalPolyfillLoaded();
  return await importOriginal();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("keeps supported standard APIs unchanged", async () => {
  const nativeTemporal = Temporal;
  const APIs = [
    Temporal,
    Symbol.dispose,
    Symbol.asyncDispose,
    DisposableStack,
    AsyncDisposableStack,
    SuppressedError
  ];
  await ensureBrowserApis();
  expect([
    Temporal,
    Symbol.dispose,
    Symbol.asyncDispose,
    DisposableStack,
    AsyncDisposableStack,
    SuppressedError
  ]).toEqual(APIs);
  expect(Temporal).toBe(nativeTemporal);
  expect(temporalPolyfillLoaded).not.toHaveBeenCalled();
});

test("installs missing Temporal before application bootstrap", async () => {
  vi.stubGlobal("Temporal", undefined);
  const bootstrap = vi.fn(async () => {
    const instant = Temporal.Instant.from("2026-10-17T00:00:00Z");
    expect(instant.add({ seconds: 30 }).toString()).toBe("2026-10-17T00:00:30Z");
    expect(Temporal.Instant.fromEpochMilliseconds(instant.epochMilliseconds).equals(instant)).toBe(
      true
    );
    expect(Temporal.Now.instant().epochMilliseconds).toBeGreaterThan(0);
  });
  await bootstrapBrowserApp(bootstrap);
  expect(temporalPolyfillLoaded).toHaveBeenCalledOnce();
  expect(bootstrap).toHaveBeenCalledOnce();
});

test("installs missing standard disposal APIs before application bootstrap", async () => {
  const nativeSymbol = Symbol;
  function IncompleteSymbol(description?: string | number) {
    return nativeSymbol(description);
  }
  for (const key of Reflect.ownKeys(nativeSymbol)) {
    if (key !== "dispose" && key !== "asyncDispose") {
      Object.defineProperty(
        IncompleteSymbol,
        key,
        Object.getOwnPropertyDescriptor(nativeSymbol, key)!
      );
    }
  }
  vi.stubGlobal("Symbol", IncompleteSymbol);
  vi.stubGlobal("DisposableStack", undefined);
  vi.stubGlobal("AsyncDisposableStack", undefined);
  vi.stubGlobal("SuppressedError", undefined);
  expect(Symbol.dispose).toBeUndefined();
  expect(Symbol.asyncDispose).toBeUndefined();
  const bootstrap = vi.fn(async () => {
    expect(typeof Symbol.dispose).toBe("symbol");
    expect(typeof Symbol.asyncDispose).toBe("symbol");
    expect(typeof SuppressedError).toBe("function");
    const order: string[] = [];
    {
      await using stack = new AsyncDisposableStack();
      stack.use({
        [Symbol.dispose]: () => {
          order.push("sync");
        }
      });
      stack.use({
        [Symbol.asyncDispose]: async () => {
          order.push("async");
        }
      });
    }
    expect(order).toEqual(["async", "sync"]);
    const stack = new DisposableStack();
    stack.defer(() => {
      order.push("complete");
    });
    stack.dispose();
    expect(order).toEqual(["async", "sync", "complete"]);
  });
  await bootstrapBrowserApp(bootstrap);
  expect(bootstrap).toHaveBeenCalledOnce();
});
