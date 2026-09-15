/** Install the standard APIs before importing any browser application modules. */
export async function ensureBrowserApis(): Promise<void> {
  const missing: Promise<unknown>[] = [];
  if (typeof globalThis.Temporal === "undefined") {
    missing.push(
      import("@js-temporal/polyfill").then(({ Temporal }) => {
        Object.defineProperty(globalThis, "Temporal", {
          value: Temporal,
          configurable: true,
          writable: true
        });
      })
    );
  }
  if (typeof Symbol.dispose !== "symbol") {
    missing.push(import("core-js/es/symbol/dispose.js"));
  }
  if (typeof Symbol.asyncDispose !== "symbol") {
    missing.push(import("core-js/es/symbol/async-dispose.js"));
  }
  if (typeof globalThis.SuppressedError !== "function") {
    missing.push(import("core-js/es/suppressed-error.js"));
  }
  if (typeof globalThis.DisposableStack !== "function") {
    missing.push(import("core-js/es/disposable-stack/index.js"));
  }
  if (typeof globalThis.AsyncDisposableStack !== "function") {
    missing.push(import("core-js/es/async-disposable-stack/index.js"));
  }
  await Promise.all(missing);
}

export async function bootstrapBrowserApp(start: () => Promise<unknown>): Promise<void> {
  await ensureBrowserApis();
  await start();
}
