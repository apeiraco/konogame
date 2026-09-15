import { createRouter } from "@tanstack/react-router";
import { Layer } from "effect";
import { attachBrowserLifecycle } from "./app/router-lifecycle.ts";
import { createWebUIAppContext, type WebUIAppOptions } from "./app/webui-app-context.ts";
import {
  interfaceLanguageKey,
  provideLocalePreferences
} from "./infrastructure/i18n/locale.service.ts";
import { routeTree } from "./routeTree.gen.ts";
import { provideSessionStorage } from "./workspace/workspace-session.service.ts";

export async function getRouter(options: WebUIAppOptions = {}) {
  const storage = provideSessionStorage(() =>
    typeof window === "undefined" ? undefined : window.sessionStorage
  );
  const localePreferences = provideLocalePreferences({
    read: () =>
      typeof window === "undefined" ? undefined : window.localStorage.getItem(interfaceLanguageKey),
    write: (language) => {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(interfaceLanguageKey, language);
      }
    }
  });
  await using construction = new AsyncDisposableStack();
  const lifetime = construction.use(new AsyncDisposableStack());
  const appContext = lifetime.use(
    await createWebUIAppContext({
      ...options,
      overrides: Layer.mergeAll(storage, localePreferences, options.overrides ?? Layer.empty)
    })
  );
  const router = createRouter({
    routeTree,
    context: { appContext, queryClient: appContext.queryClient },
    scrollRestoration: true
  });
  // A failed router construction closes the graph before ownership is transferred.
  router.serverSsrLifecycle = {
    onServerSsrAttach: [
      (server) => {
        server.onCleanup(() => {
          void lifetime.disposeAsync();
        });
      }
    ]
  };
  if (typeof window !== "undefined") {
    attachBrowserLifecycle(lifetime, appContext, {
      host: window,
      onRendered: (hydrate) => router.subscribe("onRendered", hydrate),
      hot: import.meta.hot
    });
  }
  construction.move();
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>;
  }
}
