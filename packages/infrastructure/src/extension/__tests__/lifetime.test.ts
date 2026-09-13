import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  AdapterOwnerKind,
  DECLARATION_PROTOCOL_RANGE,
  LocationTypeStatus
} from "@konogame/infrastructure/contracts";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Scope, Stream } from "effect";
import {
  descriptor,
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
  ID_SERVICE,
  LifecycleStatus,
  LOCATION_BEHAVIOR,
  provideIdService,
  provideTemporalService,
  RegistrationStatus,
  ReloadPolicy,
  TEMPORAL_SERVICE
} from "../../index.ts";

it.effect("typed clock and IDs are overridable without starting discovery", () =>
  Effect.gen(function* () {
    const instant = Temporal.Instant.from("2026-10-17T00:00:00Z");
    const overrides = Layer.merge(
      provideIdService({ uuidV7: () => Effect.succeed("synthetic-id") }),
      provideTemporalService({ now: () => Effect.succeed(instant) })
    );
    let discoveries = 0;
    const env = yield* setup(
      [],
      {},
      [
        {
          id: "source",
          discover: () =>
            Effect.sync(() => {
              discoveries++;
              return { complete: true, contributions: [] };
            })
        }
      ],
      overrides
    );
    assert.equal(yield* Context.get(env.services, ID_SERVICE).uuidV7(), "synthetic-id");
    assert.equal(yield* Context.get(env.services, TEMPORAL_SERVICE).now(), instant);
    assert.equal(discoveries, 0);
    assert.equal(env.lifecycle.snapshot, LifecycleStatus.New);
  })
);

it.effect(
  "initialization shares discovery and keeps implementation code lazy until Adapter resolution",
  () =>
    Effect.gen(function* () {
      let loads = 0;
      const item = extension("lazy");
      const original = item.load;
      item.load = () =>
        Effect.suspend(() => {
          loads++;
          return original();
        });
      const env = yield* setup([moduleContribution(), item]);
      yield* Effect.all([env.lifecycle.ready, env.lifecycle.ready], { concurrency: "unbounded" });
      assert.equal(loads, 0);
      assert.equal(env.extensions.snapshot.length, 2);
      assert.equal(env.adapters.snapshot[0]!.implementationState, "missing");
      const plans = yield* Effect.all(
        [env.adapterResolver.resolve([request]), env.adapterResolver.resolve([request])],
        { concurrency: "unbounded" }
      );
      assert.equal(loads, 1);
      assert.equal(
        yield* env.adapterResolver.implementation(plans[0]!.resolvedAdapters[0]!, port).run(),
        "lazy"
      );
    })
);

it.effect(
  "Adapter resolution prepares independently and activates only the compatible negotiated candidate",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([extension("low"), extension("high", { priority: 10 })]);
      const plan = yield* env.adapterResolver.resolve([request]);
      assert.equal(plan.resolvedAdapters[0]!.adapterId, "high.adapter");
      assert.equal(env.extensions.get("low")!.activation, ActivationStatus.Inactive);
      assert.equal(env.lifecycle.snapshot, LifecycleStatus.Prepared);
      const explicit = yield* env.adapterResolver.resolve([
        { ...request, preferredAdapterId: "missing" }
      ]);
      assert.equal(explicit.resolvedAdapters.length, 0);
    })
);

it.effect(
  "dependency activation shares generation work and Scope closes in reverse dependency order",
  () =>
    Effect.gen(function* () {
      const events: string[] = [];
      const owned = yield* Scope.make();
      const make = (id: string, dependencies?: { extensionId: string; versionRange: string }[]) =>
        extension(id, {
          manifest: dependencies ? { dependencies } : {},
          module: defineExtensionModule({
            activate: () =>
              Effect.gen(function* () {
                events.push(`start:${id}`);
                yield* addLifetimeFinalizer(
                  Effect.sync(() => {
                    events.push(`stop:${id}`);
                  })
                );
              })
          })
        });
      const env = yield* setup([
        make("dependency"),
        make("dependent", [{ extensionId: "dependency", versionRange: "^1.0.0" }])
      ]).pipe(Scope.provide(owned));
      yield* env.lifecycle.prepared;
      const results = yield* Effect.all(
        [env.activation.activate("dependent"), env.activation.activate("dependent")],
        { concurrency: "unbounded" }
      );
      assert.equal(results[0], results[1]);
      assert.deepEqual(events, ["start:dependency", "start:dependent"]);
      yield* Scope.close(owned, Exit.void);
      assert.deepEqual(events, [
        "start:dependency",
        "start:dependent",
        "stop:dependent",
        "stop:dependency"
      ]);
    })
);

it.effect(
  "partial activation stages implementations, rolls back Scope resources and caches code failure",
  () =>
    Effect.gen(function* () {
      let starts = 0,
        stops = 0;
      const item = extension("partial", {
        module: defineExtensionModule({
          activate: (context) =>
            Effect.gen(function* () {
              starts++;
              yield* addLifetimeFinalizer(
                Effect.sync(() => {
                  stops++;
                })
              );
              yield* context.registerAdapter("partial.adapter", port, {
                run: () => Effect.succeed("partial")
              });
              return yield* Effect.fail("activation failed");
            })
        })
      });
      const env = yield* setup([item]);
      yield* env.lifecycle.prepared;
      const first = yield* env.activation.activate("partial");
      assert.equal(first.status, ActivationStatus.Failed);
      assert.equal(yield* env.activation.activate("partial"), first);
      assert.equal(starts, 1);
      assert.equal(stops, 1);
      assert.equal(env.adapters.snapshot[0]!.implementationState, "missing");
    })
);

it.effect(
  "missing, incompatible and cyclic dependencies block without loading unrelated code",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([
        extension("missing", {
          manifest: { dependencies: [{ extensionId: "absent", versionRange: "*" }] }
        }),
        extension("wrong", {
          manifest: { dependencies: [{ extensionId: "dep", versionRange: "^2.0.0" }] }
        }),
        extension("dep"),
        extension("a", { manifest: { dependencies: [{ extensionId: "b", versionRange: "*" }] } }),
        extension("b", { manifest: { dependencies: [{ extensionId: "a", versionRange: "*" }] } }),
        extension("unrelated")
      ]);
      yield* env.lifecycle.prepared;
      for (const id of ["missing", "wrong", "a"]) {
        assert.equal((yield* env.activation.activate(id)).status, ActivationStatus.Blocked);
      }
      assert.equal((yield* env.activation.activate("unrelated")).status, ActivationStatus.Active);
    })
);

it.effect("removing dormant dependencies preserves blocked declarations", () =>
  Effect.gen(function* () {
    const env = yield* setup([
      extension("dep"),
      extension("child", {
        manifest: { dependencies: [{ extensionId: "dep", versionRange: "*" }] }
      })
    ]);
    yield* env.lifecycle.prepared;
    yield* env.extensions.remove("dep");
    assert.match((yield* env.activation.activate("child")).reason!, /Missing Extension dependency/);
    yield* env.lifecycle.register([extension("dep")]);
    assert.equal((yield* env.activation.activate("child")).status, ActivationStatus.Active);
  })
);

it.effect(
  "strict registration rejects ownership, declaration protocol and Location conflicts atomically",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([extension("existing")]);
      yield* env.lifecycle.prepared;
      const before = env.extensions.snapshot;
      const invalid = extension("bad", {
        manifest: { declarationProtocolRange: ">=0.1.0 <0.2.0" }
      });
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(env.extensions.registerAll([extension("staged"), invalid]))
        )
      );
      assert.equal(env.extensions.snapshot, before);
      const wrong = extension("bad", {
        manifest: {
          contributes: {
            adapters: [
              { ...descriptor("bad"), owner: { kind: AdapterOwnerKind.Extension, id: "another" } }
            ]
          }
        }
      });
      assert.ok(Exit.isFailure(yield* Effect.exit(env.extensions.register(wrong))));
      const duplicate = extension("bad", {
        manifest: { contributes: { adapters: [descriptor("existing")] } }
      });
      assert.ok(Exit.isFailure(yield* Effect.exit(env.extensions.register(duplicate))));
    })
);

it.effect("Module contributions merge one owner and activate module-owned adapters", () =>
  Effect.gen(function* () {
    const module: Contribution = {
      kind: AdapterOwnerKind.Module,
      id: "module.adapter",
      manifest: {
        id: "synthetic.module",
        declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
        features: [],
        contributes: {
          adapters: [
            {
              ...descriptor("module"),
              owner: { kind: AdapterOwnerKind.Module, id: "synthetic.module" }
            }
          ]
        }
      },
      load: () =>
        Effect.succeed(
          defineExtensionModule({
            activate: (context) =>
              context.registerAdapter("module.adapter", port, {
                run: () => Effect.succeed("module")
              })
          })
        )
    };
    const env = yield* setup([moduleContribution(), module]);
    const plan = yield* env.adapterResolver.resolve([request]);
    assert.equal(env.adapterResolver.modules().length, 1);
    assert.equal(
      yield* env.adapterResolver.implementation(plan.resolvedAdapters[0]!, port).run(),
      "module"
    );
  })
);

it.effect(
  "explicit events activate unselected contributions while implicit alternatives stay unloaded",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([
        extension("selected", { priority: 5 }),
        extension("explicit", { manifest: { activationEvents: [`onFeature:${feature.id}`] } }),
        extension("implicit")
      ]);
      yield* env.adapterResolver.resolve([request]);
      assert.equal(env.extensions.get("explicit")!.activation, ActivationStatus.Active);
      assert.equal(env.extensions.get("selected")!.activation, ActivationStatus.Active);
      assert.equal(env.extensions.get("implicit")!.activation, ActivationStatus.Inactive);
    })
);

it.effect("startup failures and malformed discovery remain isolated and diagnosable", () =>
  Effect.gen(function* () {
    const bad = extension("bad", {
      manifest: { activationEvents: ["onStartup"] },
      load: () => Effect.fail("bad loader")
    });
    const env = yield* setup([], {}, [
      source([bad, extension("good")]),
      { id: "broken", discover: () => Effect.fail("broken discovery") }
    ]);
    yield* env.lifecycle.ready;
    assert.equal(env.lifecycle.snapshot, LifecycleStatus.Ready);
    assert.equal(env.extensions.get("bad")!.activation, ActivationStatus.Failed);
    assert.equal(
      (yield* env.adapterResolver.resolve([{ ...request, preferredAdapterId: "good.adapter" }]))
        .resolvedAdapters.length,
      1
    );
    assert.ok(env.lifecycle.diagnostics.some((item) => item.sourceId === "broken"));
  })
);

it.effect("structurally valid incompatible core Module fails preparation", () =>
  Effect.gen(function* () {
    const module = moduleContribution();
    module.manifest.declarationProtocolRange = ">=0.1.0 <0.2.0";
    const env = yield* setup([module]);
    assert.ok(Exit.isFailure(yield* Effect.exit(env.lifecycle.ready)));
    assert.equal(env.lifecycle.snapshot, LifecycleStatus.Failed);
  })
);

it.effect(
  "unknown Locations stay readable and reject Adapter resolution before activating candidates",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([extension("candidate")]);
      const location = { type: "unknown.type", schemaVersion: "1.0.0", data: {} };
      yield* env.lifecycle.prepared;
      assert.equal(env.extensions.checkLocation(location).status, LocationTypeStatus.Unverified);
      const plan = yield* env.adapterResolver.resolve([{ ...request, locations: [location] }]);
      assert.equal(plan.resolvedAdapters.length, 0);
      assert.equal(env.extensions.get("candidate")!.activation, ActivationStatus.Inactive);
    })
);

it.effect(
  "active changes require restart and forged or stale resolved Adapters cannot access an implementation",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([extension("active")]);
      const plan = yield* env.adapterResolver.resolve([request]);
      assert.equal(
        (yield* env.extensions.remove("active")).status,
        RegistrationStatus.RestartRequired
      );
      assert.equal(
        (yield* env.extensions.replace(extension("active"))).status,
        RegistrationStatus.RestartRequired
      );
      assert.throws(
        () => env.adapterResolver.implementation({ ...plan.resolvedAdapters[0]! }, port),
        /not issued/
      );
    })
);

it.effect(
  "inactive replacement advances generation, failed disk loader requires process restart",
  () =>
    Effect.gen(function* () {
      const disk = extension("disk", { load: () => Effect.fail("load failed") });
      disk.reloadPolicy = ReloadPolicy.RestartAfterLoad;
      const env = yield* setup([extension("inactive"), disk]);
      yield* env.lifecycle.prepared;
      const generation = env.extensions.get("inactive")!.generation;
      yield* env.extensions.replace(extension("inactive"));
      assert.ok(env.extensions.get("inactive")!.generation > generation);
      yield* env.activation.activate("disk");
      assert.equal(
        (yield* env.extensions.replace(extension("disk"))).status,
        RegistrationStatus.RestartRequired
      );
    })
);

class SERVICE extends Context.Service<SERVICE, { value: string }>()("synthetic.service") {}
it.effect("generation Layers share typed services across async work and root overrides win", () =>
  Effect.gen(function* () {
    const item = extension("layer", {
      module: defineExtensionModule({
        layer: Layer.succeed(SERVICE, { value: "default" }),
        activate: (context) =>
          Effect.gen(function* () {
            yield* Effect.yieldNow;
            const service = yield* SERVICE;
            yield* context.registerAdapter("layer.adapter", port, {
              run: () => Effect.succeed(service.value)
            });
          })
      })
    });
    const env = yield* setup([item], {}, undefined, Layer.succeed(SERVICE, { value: "override" }));
    const plan = yield* env.adapterResolver.resolve([request]);
    assert.equal(
      yield* env.adapterResolver.implementation(plan.resolvedAdapters[0]!, port).run(),
      "override"
    );
  })
);

it.effect("dependency services are limited to declared active generation scopes", () =>
  Effect.gen(function* () {
    const dep = extension("dep", {
      module: defineExtensionModule({
        layer: Layer.succeed(SERVICE, { value: "dependency" }),
        activate: () => Effect.void
      })
    });
    const child = extension("child", {
      manifest: { dependencies: [{ extensionId: "dep", versionRange: "*" }] },
      module: defineExtensionModule({
        activate: (context) =>
          Effect.gen(function* () {
            const services = yield* context.dependencyServices("dep");
            const value = Context.get(services, SERVICE).value;
            assert.ok(Exit.isFailure(yield* Effect.exit(context.dependencyServices("undeclared"))));
            yield* context.registerAdapter("child.adapter", port, {
              run: () => Effect.succeed(value)
            });
          })
      })
    });
    const env = yield* setup([dep, child]);
    const plan = yield* env.adapterResolver.resolve([
      { ...request, preferredAdapterId: "child.adapter" }
    ]);
    assert.equal(
      yield* env.adapterResolver.implementation(plan.resolvedAdapters[0]!, port).run(),
      "dependency"
    );
  })
);

it.effect("late-installed default Layers construct once without root preregistration", () =>
  Effect.gen(function* () {
    let constructions = 0;
    const env = yield* setup();
    yield* env.lifecycle.ready;
    yield* env.lifecycle.register([
      extension("late", {
        module: defineExtensionModule({
          layer: Layer.effect(
            SERVICE,
            Effect.sync(() => {
              constructions++;
              return { value: "local" };
            })
          ),
          activate: (context) =>
            Effect.gen(function* () {
              const service = yield* SERVICE;
              yield* context.registerAdapter("late.adapter", port, {
                run: () => Effect.succeed(service.value)
              });
            })
        })
      })
    ]);
    yield* Effect.all(
      [env.adapterResolver.resolve([request]), env.adapterResolver.resolve([request])],
      {
        concurrency: "unbounded"
      }
    );
    assert.equal(constructions, 1);
  })
);

it.effect("Adapter streams replay snapshots and expose declaration and implementation events", () =>
  Effect.gen(function* () {
    const env = yield* setup([extension("events")]);
    const events: string[] = [];
    yield* Effect.forkScoped(
      Stream.runForEach(env.adapters.results$, (result) =>
        Effect.sync(() => {
          events.push(result.status);
        })
      ),
      { startImmediately: true }
    );
    yield* env.adapterResolver.resolve([request]);
    yield* drain;
    assert.ok(events.includes("declared"));
    assert.ok(events.includes("implementation-published"));
    const snapshot = yield* Stream.runHead(env.adapters.state$);
    assert.equal(Option.getOrThrow(snapshot)[0]!.activation, ActivationStatus.Active);
  })
);

it.effect("startup can resolve another capability without waiting for its own full ready", () =>
  Effect.gen(function* () {
    let env: Effect.Success<ReturnType<typeof setup>>;
    const startup = extension("startup", {
      manifest: { activationEvents: ["onStartup"], contributes: { adapters: [] } },
      module: defineExtensionModule({
        activate: () =>
          Effect.suspend(() => env.adapterResolver.resolve([request])).pipe(Effect.asVoid)
      })
    });
    env = yield* setup([startup, extension("target")]);
    yield* env.lifecycle.ready;
    assert.equal(env.extensions.get("target")!.activation, ActivationStatus.Active);
  })
);

it.effect("self activation and concurrent cross-activation return cyclic diagnostics", () =>
  Effect.gen(function* () {
    let env: Effect.Success<ReturnType<typeof setup>>;
    const gate = yield* Deferred.make<void>();
    const make = (id: string, target: string) =>
      extension(id, {
        module: defineExtensionModule({
          activate: () =>
            Effect.gen(function* () {
              yield* Deferred.await(gate);
              const result = yield* env.activation.activate(target);
              if (result.status !== ActivationStatus.Active) {
                return yield* Effect.fail(result.reason);
              }
            })
        })
      });
    env = yield* setup([make("self", "self"), make("left", "right"), make("right", "left")]);
    yield* env.lifecycle.prepared;
    const fiber = yield* Effect.forkScoped(
      Effect.all(
        [
          env.activation.activate("self"),
          env.activation.activate("left"),
          env.activation.activate("right")
        ],
        { concurrency: "unbounded" }
      )
    );
    yield* Deferred.succeed(gate, undefined);
    const results = yield* Fiber.join(fiber);
    assert.ok(results.every((result) => result.status === ActivationStatus.Failed));
    assert.ok(results.some((result) => result.reason?.includes("Cyclic activation request")));
  })
);

it.effect("malformed Location input fails before explicit activation events", () =>
  Effect.gen(function* () {
    const env = yield* setup([
      extension("explicit", { manifest: { activationEvents: [`onFeature:${feature.id}`] } })
    ]);
    const exit = yield* Effect.exit(
      env.adapterResolver.resolve([
        { ...request, locations: [{ type: "invalid", schemaVersion: "not-semver", data: {} }] }
      ])
    );
    assert.ok(Exit.isFailure(exit));
    assert.equal(env.extensions.get("explicit")!.activation, ActivationStatus.Inactive);
  })
);

it.effect(
  "concurrent blocked requests share diagnostics and retry after dependency installation",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([
        extension("child", {
          manifest: { dependencies: [{ extensionId: "missing", versionRange: "*" }] }
        })
      ]);
      yield* env.lifecycle.prepared;
      const results = yield* Effect.all(
        [env.activation.activate("child"), env.activation.activate("child")],
        { concurrency: "unbounded" }
      );
      assert.ok(results.every((result) => result.status === ActivationStatus.Blocked));
      yield* env.lifecycle.register([extension("missing")]);
      assert.equal((yield* env.activation.activate("child")).status, ActivationStatus.Active);
    })
);

it.effect(
  "Location facade belongs to the fixed core Context and is available during lazy generation Layers",
  () =>
    Effect.gen(function* () {
      let expected: unknown;
      const item = extension("location-consumer", {
        module: defineExtensionModule({
          layer: Layer.effect(
            SERVICE,
            Effect.gen(function* () {
              const locations = yield* LOCATION_BEHAVIOR;
              assert.equal(locations, expected);
              const inspected = yield* locations.inspect({
                type: "synthetic.unknown",
                schemaVersion: "1.0.0",
                data: {}
              });
              assert.equal(inspected.validation.status, "unverified");
              assert.equal(inspected.availability.status, "unavailable");
              return { value: "core-location" };
            })
          ),
          activate: (context) =>
            Effect.gen(function* () {
              const service = yield* SERVICE;
              yield* context.registerAdapter("location-consumer.adapter", port, {
                run: () => Effect.succeed(service.value)
              });
            })
        })
      });
      const env = yield* setup([item]);
      expected = Context.get(env.services, LOCATION_BEHAVIOR);
      const plan = yield* env.adapterResolver.resolve([request]);
      assert.equal(
        yield* env.adapterResolver.implementation(plan.resolvedAdapters[0]!, port).run(),
        "core-location"
      );
    })
);

it.effect(
  "interrupting one waiting caller preserves the implementation-owned shared activation fiber",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const item = extension("shared", {
        module: defineExtensionModule({
          activate: (context) =>
            Effect.gen(function* () {
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(finish);
              yield* context.registerAdapter("shared.adapter", port, {
                run: () => Effect.succeed("shared")
              });
            })
        })
      });
      const env = yield* setup([item]);
      const first = yield* Effect.forkScoped(env.adapterResolver.resolve([request]));
      yield* Deferred.await(started);
      yield* Fiber.interrupt(first);
      const second = yield* Effect.forkScoped(env.adapterResolver.resolve([request]));
      yield* Deferred.succeed(finish, undefined);
      const plan = yield* Fiber.join(second);
      assert.equal(plan.resolvedAdapters.length, 1);
      assert.equal(env.extensions.get("shared")!.activation, ActivationStatus.Active);
    })
);
