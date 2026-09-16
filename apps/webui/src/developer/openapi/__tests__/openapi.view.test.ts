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
import { afterEach, expect, it, vi } from "vitest";
import { createWebUIAppContext, type WebUIAppContext } from "../../../app/webui-app-context.ts";
import { runUiEffect } from "../../../infrastructure/effect/run-ui-effect.ts";
import { InterfaceLanguage, LOCALE } from "../../../infrastructure/i18n/locale.service.ts";
import { ApiReferencePage, fetchLocalApi } from "../openapi.view.tsx";

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  [InterfaceLanguage.Chinese, "正在加载 API 参考"],
  [InterfaceLanguage.English, "Loading API reference"]
])(
  "renders the %s API reference shell without loading browser-only Scalar during SSR",
  async (language, loading) => {
    await using appContext = await createWebUIAppContext();
    await runUiEffect(Context.get(appContext.context, LOCALE).setLanguage(language));
    const routeTree = createRootRouteWithContext<{
      appContext: WebUIAppContext;
      queryClient: QueryClient;
    }>()({
      component: () => createElement(MantineProvider, null, createElement(ApiReferencePage))
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      context: { appContext, queryClient: appContext.queryClient }
    });
    await router.load();
    expect(renderToString(createElement(RouterProvider, { router }))).toContain(loading);
  }
);

it("sends document and test requests directly to this daemon and rejects external destinations", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("window", {
    location: new URL("http://127.0.0.1:4250/developer/openapi"),
    fetch
  });

  await fetchLocalApi("/api/openapi.json");
  await fetchLocalApi(new Request("http://127.0.0.1:4250/api/health"));
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch).toHaveBeenCalledWith("/api/openapi.json", {
    mode: "same-origin",
    redirect: "error"
  });
  for (const url of [
    "https://proxy.scalar.com/api/health",
    "http://127.0.0.1:4251/api/health",
    "http://127.0.0.1:4250/developer/openapi"
  ]) {
    await expect(fetchLocalApi(url)).rejects.toThrow("this daemon's /api/ routes");
  }
  expect(fetch).toHaveBeenCalledTimes(2);
});
