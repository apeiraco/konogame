import { QueryClient } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider
} from "@tanstack/react-router";
import { Context, Effect, Layer } from "effect";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, test, vi } from "vitest";
import {
  DISCOVERY_REVIEW,
  DiscoveryReview
} from "../../game/discovery/discovery-review.service.ts";
import { LIBRARY_SERVICE, LibraryService } from "../../game/library/library.service.ts";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { DAEMON_HTTP, type DaemonHttpService } from "../../infrastructure/http/daemon-http.ts";
import {
  provideSessionStorage,
  WORKSPACE_SESSION,
  WorkspaceSession,
  workspaceSessionKey
} from "../../workspace/workspace-session.service.ts";
import { useWebUIService } from "../use-webui-service.ts";
import { createWebUIAppContext, type WebUIAppContext } from "../webui-app-context.ts";

const unusedHttp: DaemonHttpService = { request: () => Effect.die("unexpected request") };

test("closes acquired Layers and clears queries when construction fails", async () => {
  const failure = new Error("session acquisition failed");
  const order: string[] = [];
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, "cancelQueries").mockImplementation(async () => {
    order.push("cancel queries");
  });
  vi.spyOn(queryClient, "clear").mockImplementation(() => {
    order.push("clear queries");
  });
  const http = Layer.effect(
    DAEMON_HTTP,
    Effect.acquireRelease(Effect.succeed(unusedHttp), () =>
      Effect.sync(() => {
        order.push("close scope");
      })
    )
  );
  const overrides = Layer.effect(
    WORKSPACE_SESSION,
    Effect.gen(function* () {
      yield* DAEMON_HTTP;
      return yield* Effect.die(failure);
    })
  ).pipe(Layer.provideMerge(http));
  await expect(createWebUIAppContext({ overrides, queryClient })).rejects.toBe(failure);
  expect(order).toEqual(["close scope", "cancel queries", "clear queries"]);
});

test("releases the native Scope even when query cancellation rejects", async () => {
  const failure = new Error("cancel failed");
  const order: string[] = [];
  const queryClient = new QueryClient();
  vi.spyOn(queryClient, "cancelQueries").mockRejectedValue(failure);
  vi.spyOn(queryClient, "clear").mockImplementation(() => {
    order.push("clear queries");
  });
  const appContext = await createWebUIAppContext({
    queryClient,
    overrides: Layer.effect(
      DAEMON_HTTP,
      Effect.acquireRelease(Effect.succeed(unusedHttp), () =>
        Effect.sync(() => {
          order.push("close scope");
        })
      )
    )
  });
  await expect(appContext[Symbol.asyncDispose]()).rejects.toBe(failure);
  expect(order).toEqual(["close scope", "clear queries"]);
  await appContext[Symbol.asyncDispose]();
});

test("builds independent native Layer graphs, honors root overrides and releases owned services", async () => {
  const stored = new Map([[workspaceSessionKey, JSON.stringify({ root: "/synthetic/a" })]]);
  let released = 0;
  const overrides = Layer.merge(
    Layer.effect(
      DAEMON_HTTP,
      Effect.acquireRelease(Effect.succeed(unusedHttp), () =>
        Effect.sync(() => {
          released++;
        })
      )
    ),
    provideSessionStorage(() => ({
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => {
        stored.set(key, value);
      }
    }))
  );
  await using a = await createWebUIAppContext({ overrides });
  await using b = await createWebUIAppContext({
    overrides: Layer.succeed(DAEMON_HTTP, unusedHttp)
  });
  try {
    expect(Context.get(a.context, DAEMON_HTTP)).toBe(unusedHttp);
    const aSession = Context.get(a.context, WORKSPACE_SESSION);
    const bSession = Context.get(b.context, WORKSPACE_SESSION);
    expect(aSession.workspaceRoot.peek()).toBe("");
    await a.hydrate();
    expect(aSession.workspaceRoot.peek()).toBe("/synthetic/a");
    expect(bSession.workspaceRoot.peek()).toBe("");
    const wall = Context.get(a.context, LIBRARY_SERVICE).wall("/synthetic/a");
    wall.setQuery("selected");
    expect(Context.get(b.context, LIBRARY_SERVICE).wall("/synthetic/a").filter.peek().query).toBe(
      ""
    );
    const review = Context.get(a.context, DISCOVERY_REVIEW);
    review.updateForm({ hostId: "host-a" });
    await a[Symbol.asyncDispose]();
    await runUiEffect(aSession.setWorkspaceRoot("/synthetic/after-close"));
    review.updateForm({ hostId: "host-b" });
    expect(review.state.peek().form.hostId).toBe("");
    expect(released).toBe(1);
    expect(bSession.workspaceRoot.peek()).toBe("");
  } finally {
    await a[Symbol.asyncDispose]();
    await b[Symbol.asyncDispose]();
  }
  expect(released).toBe(1);
});

test("owner Layers replace session, library and review without constructing default observers", async () => {
  const session = new WorkspaceSession(() => ({
    getItem: () => JSON.stringify({ root: "/synthetic/override" }),
    setItem: () => {}
  }));
  const library = new LibraryService(unusedHttp);
  const review = new DiscoveryReview(session, unusedHttp, { invalidate: () => Effect.void });
  const observe = vi.spyOn(DiscoveryReview.prototype, "observeSession");
  await using appContext = await createWebUIAppContext({
    overrides: Layer.mergeAll(
      Layer.succeed(WORKSPACE_SESSION, session),
      Layer.succeed(LIBRARY_SERVICE, library),
      Layer.succeed(DISCOVERY_REVIEW, review),
      provideSessionStorage(() => {
        throw new Error("default session storage must not be used");
      })
    )
  });
  try {
    await appContext.hydrate();
    expect(session.workspaceRoot.peek()).toBe("/synthetic/override");
    const observed: unknown[] = [];
    const root = createRootRouteWithContext<{
      appContext: WebUIAppContext;
      queryClient: QueryClient;
    }>()({
      component: () => {
        observed.push(
          useWebUIService(WORKSPACE_SESSION),
          useWebUIService(LIBRARY_SERVICE),
          useWebUIService(DISCOVERY_REVIEW)
        );
        return null;
      }
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ["/"] }),
      context: { appContext, queryClient: appContext.queryClient }
    });
    await router.load();
    renderToString(createElement(RouterProvider, { router }));
    expect(observed).toEqual([session, library, review]);
    expect(observe).not.toHaveBeenCalled();
  } finally {
    await appContext[Symbol.asyncDispose]();
    observe.mockRestore();
  }
});
