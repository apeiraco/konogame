import { MantineProvider } from "@mantine/core";
import { type QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider
} from "@tanstack/react-router";
import { Context } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vitest";
import { createWebUIAppContext, type WebUIAppContext } from "../../../app/webui-app-context.ts";
import { runUiEffect } from "../../effect/run-ui-effect.ts";
import { ApiNetworkError, ApiRequestError } from "../../http/daemon-http.ts";
import { InterfaceLanguage, LOCALE } from "../../i18n/locale.service.ts";
import { ErrorNotice } from "../error-notice.view.tsx";

test("translates an existing transport failure at display time and preserves daemon diagnostics", async () => {
  await using appContext = await createWebUIAppContext();
  let error: unknown = new ApiNetworkError({ path: "/api/games", cause: new Error("offline") });
  const routeTree = createRootRouteWithContext<{
    appContext: WebUIAppContext;
    queryClient: QueryClient;
  }>()({
    component: () =>
      createElement(MantineProvider, null, createElement(ErrorNotice, { error, retry: () => {} }))
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { appContext, queryClient: appContext.queryClient }
  });
  await router.load();
  const render = () => renderToString(createElement(RouterProvider, { router }));
  expect(render()).toContain("无法连接本机 daemon");
  await runUiEffect(Context.get(appContext.context, LOCALE).setLanguage(InterfaceLanguage.English));
  const english = render();
  expect(english).toContain("Cannot reach the local daemon");
  expect(english).toContain("Retry");
  error = new ApiRequestError(409, {
    error: { tag: "WorkspaceConflict", message: "External diagnostic", issues: [{ path: "root" }] }
  });
  const diagnostic = render();
  expect(diagnostic).toContain("External diagnostic");
  expect(diagnostic).toContain("root");
});
