import { attachRouterServerSsrUtils } from "@tanstack/react-router/ssr/server";
import { Context, Effect, Layer } from "effect";
import { expect, test, vi } from "vitest";
import { DAEMON_HTTP } from "../../infrastructure/http/daemon-http.ts";
import { getRouter } from "../../router.tsx";
import {
  provideSessionStorage,
  WORKSPACE_SESSION
} from "../../workspace/workspace-session.service.ts";
import { attachBrowserLifecycle } from "../router-lifecycle.ts";
import { createWebUIAppContext } from "../webui-app-context.ts";

test.each(["pagehide", "HMR"])(
  "closes browser Layers on %s and removes subscriptions",
  async (trigger) => {
    let released = 0;
    let reads = 0;
    const appContext = await createWebUIAppContext({
      overrides: Layer.merge(
        Layer.effect(
          DAEMON_HTTP,
          Effect.acquireRelease(
            Effect.succeed({ request: () => Effect.die("unexpected request") }),
            () =>
              Effect.sync(() => {
                released++;
              })
          )
        ),
        provideSessionStorage(() => ({
          getItem: () => {
            reads++;
            return "/synthetic/restored";
          },
          setItem: () => {}
        }))
      )
    });
    await using lifetime = new AsyncDisposableStack();
    lifetime.use(appContext);
    const host = new EventTarget();
    const remove = vi.spyOn(host, "removeEventListener");
    const unsubscribe = vi.fn();
    let render!: () => void;
    let replace!: () => void;
    attachBrowserLifecycle(lifetime, appContext, {
      host,
      onRendered: (callback) => {
        render = callback;
        return unsubscribe;
      },
      hot: {
        dispose: (callback) => {
          replace = () => callback({});
        }
      }
    });
    expect(reads).toBe(0);
    render();
    await expect.poll(() => reads).toBe(1);
    expect(Context.get(appContext.context, WORKSPACE_SESSION).workspaceRoot.peek()).toBe(
      "/synthetic/restored"
    );
    const persisted = new Event("pagehide");
    Object.defineProperty(persisted, "persisted", { value: true });
    host.dispatchEvent(persisted);
    expect(released).toBe(0);
    if (trigger === "pagehide") {
      host.dispatchEvent(new Event("pagehide"));
    } else {
      replace();
    }
    await expect.poll(() => released).toBe(1);
    expect(remove).toHaveBeenCalledWith("pagehide", expect.any(Function));
    expect(unsubscribe).toHaveBeenCalled();
    replace();
    await lifetime.disposeAsync();
    expect(released).toBe(1);
  }
);

test("closes the service graph if browser lifecycle registration fails", async () => {
  let released = 0;
  const failure = new Error("browser listener registration failed");
  const unsubscribe = vi.fn();
  const host = new EventTarget();
  vi.spyOn(host, "addEventListener").mockImplementation(() => {
    throw failure;
  });
  await expect(
    (async () => {
      await using lifetime = new AsyncDisposableStack();
      const appContext = lifetime.use(
        await createWebUIAppContext({
          overrides: Layer.effect(
            DAEMON_HTTP,
            Effect.acquireRelease(
              Effect.succeed({ request: () => Effect.die("unexpected request") }),
              () =>
                Effect.sync(() => {
                  released++;
                })
            )
          )
        })
      );
      attachBrowserLifecycle(lifetime, appContext, { host, onRendered: () => unsubscribe });
    })()
  ).rejects.toBe(failure);
  expect(released).toBe(1);
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("Start keeps server routers isolated and releases the native Scope on SSR cleanup", async () => {
  let released = 0;
  let reads = 0;
  const overrides = Layer.merge(
    Layer.effect(
      DAEMON_HTTP,
      Effect.acquireRelease(
        Effect.succeed({ request: () => Effect.die("prerender must not request Workspace data") }),
        () =>
          Effect.sync(() => {
            released++;
          })
      )
    ),
    provideSessionStorage(() => ({
      getItem: () => {
        reads++;
        return "/synthetic/private";
      },
      setItem: () => {}
    }))
  );
  const a = await getRouter({ overrides });
  const b = await getRouter({ overrides });
  try {
    expect(a.options.context.appContext.context).not.toBe(b.options.context.appContext.context);
    expect(a.options.context.queryClient).not.toBe(b.options.context.queryClient);
    expect(
      Context.get(a.options.context.appContext.context, WORKSPACE_SESSION).workspaceRoot.peek()
    ).toBe("");
    expect(reads).toBe(0);
    attachRouterServerSsrUtils({ router: a, manifest: undefined });
    attachRouterServerSsrUtils({ router: b, manifest: undefined });
    a.serverSsr!.cleanup();
    await expect.poll(() => released).toBe(1);
    b.serverSsr!.cleanup();
    await expect.poll(() => released).toBe(2);
  } finally {
    await a.options.context.appContext[Symbol.asyncDispose]();
    await b.options.context.appContext[Symbol.asyncDispose]();
  }
});
