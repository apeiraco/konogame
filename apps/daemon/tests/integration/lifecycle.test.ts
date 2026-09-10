import { expect, it } from "@effect/vitest";
import { composeDaemon, startDaemon } from "@konogame/daemon";
import { defineExtensionModule, FEATURE_PLAN } from "@konogame/infrastructure";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect";

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
                      contractRange: "^0.2.0",
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
        if (!address || typeof address === "string") throw new Error("Expected local listener");
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
              const plan = Context.get(services, FEATURE_PLAN);
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
      if (!address || typeof address === "string") throw new Error("Expected local listener");
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
    if (exit._tag === "Failure")
      expect(Cause.prettyErrors(exit.cause).map((error) => error.message)).toContain(
        failure.message
      );
    expect(calls).toBe(1);
  })
);
