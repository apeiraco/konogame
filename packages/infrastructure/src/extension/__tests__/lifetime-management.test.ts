import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { toInternalSchema } from "@konogame/infrastructure/contracts";
import { Cause, Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import {
  drain,
  extension,
  feature,
  moduleContribution,
  port,
  request,
  setup,
  source
} from "../../__tests__/support.ts";
import {
  ActivationStatus,
  addLifetimeFinalizer,
  type Contribution,
  defineExtensionModule,
  LifecyclePhase,
  LifecycleStatus,
  LifetimePolicy,
  RegistrationStatus,
  ReloadPolicy
} from "../../index.ts";

it.effect("catalog preparation and refresh do not run startup", () =>
  Effect.gen(function* () {
    let starts = 0;
    const item = extension("startup", {
      manifest: { activationEvents: ["onStartup"] },
      module: defineExtensionModule({
        activate: () =>
          Effect.sync(() => {
            starts++;
          })
      })
    });
    const env = yield* setup([item]);
    yield* env.lifecycle.prepared;
    yield* env.lifecycle.refresh();
    assert.equal(starts, 0);
    assert.equal(env.lifecycle.snapshot, LifecycleStatus.Prepared);
    yield* env.lifecycle.ready;
    assert.equal(starts, 1);
  })
);

it.effect(
  "malformed discovery batches and individual records are isolated without executing accessors",
  () =>
    Effect.gen(function* () {
      let reads = 0;
      const hostile = Object.defineProperty({}, "manifest", {
        enumerable: true,
        get() {
          reads++;
          throw new Error("getter");
        }
      });
      const env = yield* setup([], {}, [
        {
          id: "mixed",
          discover: () =>
            Effect.succeed({
              complete: true,
              contributions: [null, hostile, extension("good")] as unknown as Contribution[]
            })
        },
        { id: "bad", discover: () => Effect.succeed(null as never) }
      ]);
      yield* env.lifecycle.prepared;
      assert.equal(reads, 0);
      assert.ok(env.extensions.get("good"));
      assert.ok(env.lifecycle.diagnostics.length >= 3);
    })
);

it.effect(
  "sparse arrays reject before traversal and incomplete batches preserve source ownership",
  () =>
    Effect.gen(function* () {
      let contributions: readonly Contribution[] = [extension("retained")];
      const env = yield* setup([], {}, [
        { id: "source", discover: () => Effect.succeed({ complete: true, contributions }) }
      ]);
      yield* env.lifecycle.prepared;
      contributions = new Array(2 ** 30);
      const result = yield* env.lifecycle.refresh();
      assert.ok(env.extensions.get("retained"));
      assert.equal(result.removed.length, 0);
    })
);

it.effect(
  "unchanged revisions retain generation while partial scans never delete unseen records",
  () =>
    Effect.gen(function* () {
      const item = extension("stable");
      item.revision = "revision-1";
      let complete = true,
        contributions: readonly Contribution[] = [item];
      const env = yield* setup([], {}, [
        { id: "source", discover: () => Effect.succeed({ complete, contributions }) }
      ]);
      yield* env.lifecycle.prepared;
      const generation = env.extensions.get("stable")!.generation;
      contributions = [{ ...item, load: () => Effect.fail("must not reload") }];
      assert.deepEqual((yield* env.lifecycle.refresh()).unchanged, ["stable"]);
      assert.equal(env.extensions.get("stable")!.generation, generation);
      complete = false;
      contributions = [];
      yield* env.lifecycle.refresh();
      assert.ok(env.extensions.get("stable"));
      complete = true;
      yield* env.lifecycle.refresh();
      assert.equal(env.extensions.get("stable"), undefined);
    })
);

it.effect(
  "source conflicts reject both fresh contributions without selecting by source order",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([], {}, [
        source([extension("conflict")], "one"),
        source([extension("conflict")], "two")
      ]);
      yield* env.lifecycle.prepared;
      assert.equal(env.extensions.get("conflict"), undefined);
      assert.equal(env.lifecycle.diagnostics.length, 2);
    })
);

it.effect("discovery deadlines retain a usable catalog using TestClock", () =>
  Effect.gen(function* () {
    const env = yield* setup([], { budgets: { discoveryMs: 10 } }, [
      source([extension("good")]),
      { id: "hung", discover: () => Effect.never }
    ]);
    const prepared = yield* Effect.forkScoped(env.lifecycle.prepared);
    yield* TestClock.adjust(10);
    yield* Fiber.join(prepared);
    assert.ok(env.extensions.get("good"));
    assert.ok(
      env.lifecycle.diagnostics.some(
        (item) => item.phase === LifecyclePhase.Discovery && item.reason.includes("deadline")
      )
    );
  })
);

it.effect(
  "loader deadlines interrupt cooperative code, cache failure and cannot publish late code",
  () =>
    Effect.gen(function* () {
      let interrupted = false,
        loads = 0;
      const item = extension("hung", {
        load: () =>
          Effect.gen(function* () {
            loads++;
            yield* Effect.never;
            return defineExtensionModule({ activate: () => Effect.void });
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              })
            )
          )
      });
      const env = yield* setup([item], { budgets: { loadMs: 10 } });
      yield* env.lifecycle.prepared;
      const running = yield* Effect.forkScoped(env.activation.activate("hung"));
      yield* TestClock.adjust(10);
      const first = yield* Fiber.join(running);
      assert.equal(first.status, ActivationStatus.Failed);
      assert.equal(interrupted, true);
      assert.equal(yield* env.activation.activate("hung"), first);
      assert.equal(loads, 1);
    })
);

it.effect(
  "activation timeout seals captured contexts and rolls back staged implementation publication",
  () =>
    Effect.gen(function* () {
      let captured: Parameters<ReturnType<typeof defineExtensionModule>["activate"]>[0] | undefined;
      const item = extension("hung", {
        module: defineExtensionModule({
          activate: (context) =>
            Effect.gen(function* () {
              captured = context;
              yield* context.registerAdapter("hung.adapter", port, {
                run: () => Effect.succeed("staged")
              });
              yield* Effect.never;
            })
        })
      });
      const env = yield* setup([item], { budgets: { activationMs: 10 } });
      yield* env.lifecycle.prepared;
      const running = yield* Effect.forkScoped(env.activation.activate("hung"));
      yield* TestClock.adjust(10);
      assert.equal((yield* Fiber.join(running)).status, ActivationStatus.Failed);
      assert.equal(env.adapters.snapshot[0]!.implementationState, "missing");
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            captured!.registerAdapter("hung.adapter", port, { run: () => Effect.succeed("late") })
          )
        )
      );
    })
);

it.effect("Scope closes activation fibers without publishing late implementations", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const env = yield* setup([
      extension("hung", {
        module: defineExtensionModule({
          activate: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
        })
      })
    ]).pipe(Scope.provide(scope));
    yield* env.lifecycle.prepared;
    const caller = yield* Effect.forkScoped(Effect.exit(env.activation.activate("hung")));
    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    const exit = yield* Fiber.join(caller);
    assert.ok(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      assert.ok(Cause.hasInterrupts(exit.cause));
    }
    assert.equal(env.lifecycle.snapshot, LifecycleStatus.Disposed);
    assert.equal(env.adapters.snapshot.length, 0);
  })
);

it.effect(
  "bounded native finalizers interrupt cooperative never and continue reverse cleanup",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const order: string[] = [];
      const item = extension("cleanup", {
        module: defineExtensionModule({
          activate: () =>
            Effect.gen(function* () {
              yield* addLifetimeFinalizer(
                Effect.sync(() => {
                  order.push("first");
                })
              );
              yield* addLifetimeFinalizer(Effect.never);
              yield* addLifetimeFinalizer(
                Effect.sync(() => {
                  order.push("last");
                })
              );
            })
        })
      });
      const env = yield* setup([item], { budgets: { cleanupMs: 5, shutdownMs: 20 } }).pipe(
        Scope.provide(scope)
      );
      yield* env.lifecycle.prepared;
      yield* env.activation.activate("cleanup");
      const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void));
      yield* TestClock.adjust(5);
      yield* Fiber.join(closing);
      assert.deepEqual(order, ["last", "first"]);
    })
);

it.effect(
  "total shutdown budget bounds sequential cooperative cleanup and still attempts synchronous callbacks",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const order: string[] = [];
      const item = extension("cleanup", {
        module: defineExtensionModule({
          activate: () =>
            Effect.gen(function* () {
              yield* addLifetimeFinalizer(
                Effect.sync(() => {
                  order.push("first");
                })
              );
              yield* addLifetimeFinalizer(Effect.never);
              yield* addLifetimeFinalizer(Effect.never);
            })
        })
      });
      const env = yield* setup([item], { budgets: { cleanupMs: 5, shutdownMs: 6 } }).pipe(
        Scope.provide(scope)
      );
      yield* env.lifecycle.prepared;
      yield* env.activation.activate("cleanup");
      const closing = yield* Effect.forkScoped(Scope.close(scope, Exit.void));
      yield* TestClock.adjust(6);
      yield* Fiber.join(closing);
      assert.deepEqual(order, ["first"]);
    })
);

it.effect(
  "failed and malformed refreshes retain prior records, active replacements require restart",
  () =>
    Effect.gen(function* () {
      let fail = false;
      let item = extension("active");
      item.revision = "revision-1";
      const env = yield* setup([], {}, [
        {
          id: "source",
          discover: () =>
            fail
              ? Effect.fail("disk failure")
              : Effect.succeed({ complete: true, contributions: [item] })
        }
      ]);
      yield* env.adapterResolver.resolve([request]);
      fail = true;
      yield* env.lifecycle.refresh();
      assert.ok(env.extensions.get("active"));
      fail = false;
      item = { ...item, revision: "revision-2" };
      assert.deepEqual((yield* env.lifecycle.refresh()).restartRequired, ["active"]);
      assert.equal(
        env.extensions.source("active", env.extensions.get("active")!.generation).revision,
        "revision-1"
      );
    })
);

it.effect("late Module declarations replay remembered feature events", () =>
  Effect.gen(function* () {
    const env = yield* setup([extension("candidate")]);
    yield* env.lifecycle.prepared;
    yield* env.activation.trigger(`onFeature:${feature.id}`);
    assert.equal(env.extensions.get("candidate")!.activation, ActivationStatus.Inactive);
    yield* env.lifecycle.register([moduleContribution()]);
    assert.equal(env.extensions.get("candidate")!.activation, ActivationStatus.Active);
  })
);

it.effect(
  "complete Adapter resolution demand replay uses bounded eviction and preserves request operands",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([], { demandCacheLimit: 1 });
      yield* env.lifecycle.prepared;
      yield* env.adapterResolver.resolve([{ ...request, preferredAdapterId: "old.adapter" }]);
      yield* env.adapterResolver.resolve([{ ...request, preferredAdapterId: "current.adapter" }]);
      yield* env.lifecycle.register([extension("old"), extension("current")]);
      assert.equal(env.extensions.get("old")!.activation, ActivationStatus.Inactive);
      assert.equal(env.extensions.get("current")!.activation, ActivationStatus.Active);
    })
);

it.effect("failed installed-code attempts remain restart restricted after source refresh", () =>
  Effect.gen(function* () {
    let item = extension("disk", { load: () => Effect.fail("bad module") });
    item.revision = "revision-1";
    item.reloadPolicy = ReloadPolicy.RestartAfterLoad;
    const env = yield* setup([], {}, [
      {
        id: "disk.source",
        discover: () => Effect.succeed({ complete: true, contributions: [item] })
      }
    ]);
    yield* env.lifecycle.prepared;
    yield* env.activation.activate("disk");
    item = { ...item, revision: "revision-2" };
    assert.equal((yield* env.lifecycle.refresh()).status, RegistrationStatus.RestartRequired);
  })
);

it("lifetime budgets reject fractional nonfinite and overflowing native delays", () => {
  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
    assert.throws(() => new LifetimePolicy({ budgets: { loadMs: value } }));
  }
  assert.throws(() => new LifetimePolicy({ demandCacheLimit: 0 }));
});

it.effect(
  "Standard Schema executable hooks normalize into portable declarations and retain source ownership",
  () =>
    Effect.gen(function* () {
      let hooks = 0;
      const schema = Object.defineProperty({}, "~standard", {
        get() {
          hooks++;
          return { version: 1, vendor: "synthetic", validate: (value: unknown) => ({ value }) };
        }
      });
      assert.ok(toInternalSchema(schema as never));
      const item = extension("standard", {
        manifest: {
          contributes: {
            locations: [
              {
                type: "synthetic.standard",
                schemaVersion: "1.0.0",
                schemaRange: "^1.0.0",
                dataSchema: schema as never
              }
            ]
          }
        }
      });
      item.revision = "revision-1";
      let present = true;
      const env = yield* setup([], {}, [
        {
          id: "standard.source",
          discover: () => Effect.succeed({ complete: true, contributions: present ? [item] : [] })
        }
      ]);
      yield* env.lifecycle.prepared;
      assert.ok(hooks > 0);
      assert.equal(
        typeof env.extensions.getLocationType("synthetic.standard")!.definition.dataSchema,
        "object"
      );
      assert.deepEqual((yield* env.lifecycle.refresh()).unchanged, ["standard"]);
      present = false;
      assert.deepEqual((yield* env.lifecycle.refresh()).removed, ["standard"]);
    })
);

it.effect(
  "cancelled preparation and ready reject while an external Promise cannot publish late records",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const external = Promise.withResolvers<{
        complete: boolean;
        contributions: readonly Contribution[];
      }>();
      const started = yield* Deferred.make<void>();
      const env = yield* setup([], {}, [
        {
          id: "external.io",
          discover: () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.promise(() => external.promise))
            )
        }
      ]).pipe(Scope.provide(scope));
      const prepared = yield* Effect.forkScoped(Effect.exit(env.lifecycle.prepared));
      const ready = yield* Effect.forkScoped(Effect.exit(env.lifecycle.ready));
      yield* Deferred.await(started);
      yield* Scope.close(scope, Exit.void);
      for (const fiber of [prepared, ready]) {
        const exit = yield* Fiber.join(fiber);
        assert.ok(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          assert.ok(Cause.hasInterrupts(exit.cause));
        }
      }
      external.resolve({ complete: true, contributions: [extension("late")] });
      yield* drain;
      assert.equal(env.extensions.get("late"), undefined);
      assert.equal(env.lifecycle.snapshot, LifecycleStatus.Disposed);
    })
);

it.effect("late Location declarations replay retained complete Adapter resolution requests", () =>
  Effect.gen(function* () {
    const item = extension("candidate");
    item.manifest.contributes!.adapters![0]!.locations = [
      { type: "synthetic.late", schemaRange: "^1.0.0" }
    ];
    const env = yield* setup([item]);
    const location = { type: "synthetic.late", schemaVersion: "1.0.0", data: {} };
    assert.equal(
      (yield* env.adapterResolver.resolve([{ ...request, locations: [location] }])).resolvedAdapters
        .length,
      0
    );
    yield* env.lifecycle.register([
      extension("definitions", {
        manifest: {
          contributes: {
            locations: [
              {
                type: location.type,
                schemaVersion: "1.0.0",
                schemaRange: "^1.0.0",
                dataSchema: { type: "object" }
              }
            ]
          }
        }
      })
    ]);
    assert.equal(env.extensions.get("candidate")!.activation, ActivationStatus.Active);
  })
);

it.effect("cleanup failures retain diagnostic causes after publication channels close", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const env = yield* setup([
      extension("cleanup", {
        module: defineExtensionModule({
          activate: () => addLifetimeFinalizer(Effect.die(new Error("cleanup defect")))
        })
      })
    ]).pipe(Scope.provide(scope));
    yield* env.lifecycle.prepared;
    yield* env.activation.activate("cleanup");
    yield* Scope.close(scope, Exit.void);
    assert.ok(
      env.lifecycle.diagnostics.some(
        (item) => item.phase === LifecyclePhase.Cleanup && item.reason.includes("cleanup defect")
      )
    );
  })
);

it.effect(
  "legacy Promise modules loaders sources and activation are rejected with late rejection observed",
  () =>
    Effect.gen(function* () {
      const legacy = () => Promise.reject(new Error("legacy asynchronous boundary"));
      const candidates = [
        extension("promise-loader", { load: legacy as never }),
        extension("promise-module", { load: () => Effect.succeed(legacy() as never) }),
        extension("promise-activate", {
          module: defineExtensionModule({ activate: legacy as never })
        }),
        extension("promise-layer", {
          module: defineExtensionModule({ layer: legacy as never, activate: () => Effect.void })
        })
      ];
      const env = yield* setup([], {}, [
        source(candidates),
        { id: "legacy.source", discover: legacy as never }
      ]);
      yield* env.lifecycle.prepared;
      for (const candidate of candidates) {
        assert.equal(
          (yield* env.activation.activate(candidate.manifest.id)).status,
          ActivationStatus.Failed
        );
      }
      yield* Effect.promise(() => Promise.resolve());
      assert.ok(env.lifecycle.diagnostics.some((item) => item.sourceId === "legacy.source"));
    })
);
