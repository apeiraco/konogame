import { type WebUIAppContext } from "./webui-app-context.ts";

export interface BrowserLifecycle {
  readonly host: Pick<Window, "addEventListener" | "removeEventListener">;
  readonly onRendered: (hydrate: () => void) => () => void;
  readonly hot?: Pick<NonNullable<ImportMeta["hot"]>, "dispose">;
}

/** Start's callbacks transfer ownership to the browser page or SSR request. */
export function attachBrowserLifecycle(
  lifetime: AsyncDisposableStack,
  appContext: WebUIAppContext,
  { host, onRendered, hot }: BrowserLifecycle
): void {
  const unsubscribe = onRendered(() => {
    unsubscribe();
    void appContext.hydrate();
  });
  lifetime.defer(unsubscribe);
  const close = (event: Event) => {
    if (!(event as PageTransitionEvent).persisted) {
      void lifetime.disposeAsync();
    }
  };
  host.addEventListener("pagehide", close);
  lifetime.defer(() => host.removeEventListener("pagehide", close));
  hot?.dispose(() => {
    void lifetime.disposeAsync();
  });
}
