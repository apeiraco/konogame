import { expect, it } from "@effect/vitest";
import { composeDaemon, startDaemon } from "@konogame/daemon";
import { workspaceTomlConfigurationAdapter } from "@konogame/extension-workspace-toml";
import { ADAPTER_RESOLUTION_PLANNER, defineExtensionModule } from "@konogame/infrastructure";
import { WorkspaceFeature } from "@konogame/workspace/contracts";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";

it.effect("daemon composition resolves configuration through the bundled TOML Extension", () =>
  Effect.gen(function* () {
    const services = yield* Layer.build(composeDaemon());
    const plan = yield* Context.get(services, ADAPTER_RESOLUTION_PLANNER).plan([
      WorkspaceFeature.Inspect
    ]);
    expect(plan.unavailable).toEqual([]);
    expect(plan.resolvedAdapters[0]?.adapterId).toBe(workspaceTomlConfigurationAdapter.id);
    expect(plan.resolvedAdapters[0]?.owner).toEqual(workspaceTomlConfigurationAdapter.owner);
  })
);

it.live("daemon waits for startup and releases acquired services after listener failure", () =>
  Effect.gen(function* () {
    let cleanups = 0;
    const applicationFactory = () =>
      composeDaemon({
        discoverySources: [
          {
            id: "fixture.lifecycle-source",
            discover: () =>
              Effect.succeed({
                complete: true,
                contributions: [
                  {
                    kind: "extension",
                    manifest: {
                      id: "fixture.lifecycle",
                      version: "1.0.0",
                      declarationProtocolRange: "^0.2.0",
                      software: {},
                      activationEvents: ["onStartup"],
                      contributes: {}
                    },
                    load: () =>
                      Effect.succeed(
                        defineExtensionModule({
                          activate: () =>
                            Effect.addFinalizer(() =>
                              Effect.sync(() => {
                                cleanups++;
                              })
                            )
                        })
                      )
                  }
                ]
              })
          }
        ]
      });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const server = yield* startDaemon({ port: 0, overrides: applicationFactory() });
        expect(cleanups).toBe(0);
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Expected local listener");
        }
        const failed = yield* Effect.result(
          Effect.scoped(startDaemon({ port: address.port, overrides: applicationFactory() }))
        );
        expect(failed).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DaemonError", cause: { code: "EADDRINUSE" } }
        });
        expect(cleanups).toBe(1);
      })
    );
    expect(cleanups).toBe(2);
  })
);

it.live(
  "closing daemon Scope interrupts an active request and finalizes it before application release",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const events: string[] = [];
      const scope = yield* Scope.make();
      const applicationFactory = () =>
        composeDaemon().pipe(
          Layer.tap((services) =>
            Effect.gen(function* () {
              const plan = Context.get(services, ADAPTER_RESOLUTION_PLANNER);
              plan.plan = () =>
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      events.push("request");
                    })
                  );
                  yield* Deferred.succeed(started, undefined);
                  return yield* Effect.never;
                }).pipe(Effect.scoped);
              yield* Effect.addFinalizer(() =>
                Effect.sync(() => {
                  events.push("application");
                })
              );
            })
          )
        );
      const server = yield* startDaemon({ port: 0, overrides: applicationFactory() }).pipe(
        Effect.provideService(Scope.Scope, scope)
      );
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected local listener");
      }
      const response = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${address.port}/plan`)
      ).pipe(Effect.exit, Effect.forkChild);
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);
      expect(events).toEqual(["request", "application"]);
      expect(server.listening).toBe(false);
      yield* Fiber.join(response);
    })
);

it.effect("daemon Scope exposes application finalizer failures", () =>
  Effect.gen(function* () {
    const failure = new Error("Synthetic cleanup failure");
    let calls = 0;
    const applicationFactory = () =>
      composeDaemon().pipe(
        Layer.tap(() =>
          Effect.addFinalizer(() =>
            Effect.sync(() => {
              calls++;
            }).pipe(Effect.andThen(Effect.die(failure)))
          )
        )
      );
    const exit = yield* Effect.exit(
      Effect.scoped(startDaemon({ port: 0, overrides: applicationFactory() }))
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      expect(Cause.prettyErrors(exit.cause).map((error) => error.message)).toContain(
        failure.message
      );
    }
    expect(calls).toBe(1);
  })
);

it.live("client disconnect interrupts its workflow and preserves the daemon listener", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const finalized = yield* Deferred.make<void>();
    const application = composeDaemon().pipe(
      Layer.tap((services) =>
        Effect.sync(() => {
          Context.get(services, ADAPTER_RESOLUTION_PLANNER).plan = () =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Deferred.succeed(finalized, undefined));
              yield* Deferred.succeed(started, undefined);
              return yield* Effect.never;
            }).pipe(Effect.scoped);
        })
      )
    );
    const server = yield* startDaemon({ port: 0, overrides: application });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP listener");
    }
    const base = `http://127.0.0.1:${address.port}`;
    const controller = new AbortController();
    const response = yield* Effect.promise(() =>
      fetch(`${base}/plan`, { signal: controller.signal })
    ).pipe(Effect.exit, Effect.forkChild);
    yield* Deferred.await(started);
    controller.abort();
    yield* Deferred.await(finalized);
    expect((yield* Fiber.join(response))._tag).toBe("Failure");
    expect((yield* Effect.promise(() => fetch(`${base}/health`))).status).toBe(200);
    expect(server.listening).toBe(true);
  })
);
