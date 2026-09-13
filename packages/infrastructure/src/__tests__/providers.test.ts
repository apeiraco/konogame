import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import { expectTypeOf, vi } from "vitest";
import {
  ADAPTER_REGISTRY,
  ADAPTER_RESOLVER,
  defineExtensionModule,
  EXTENSION_ACTIVATION,
  EXTENSION_LIFECYCLE,
  EXTENSION_REGISTRY,
  ExtensionActivationService,
  ID_SERVICE,
  InfrastructureError,
  type InfrastructureServices,
  LIFETIME_POLICY,
  LifecyclePhase,
  LifecycleStatus,
  LOCATION_BEHAVIOR,
  provideIdService,
  provideInfrastructure,
  provideTemporalService,
  TEMPORAL_SERVICE
} from "../index.ts";
import { extension, port, request, setup } from "./support.ts";

type RootAccess = Parameters<typeof ExtensionActivationService.make>[3];
const originalMake = ExtensionActivationService.make;
afterEach(() => {
  vi.restoreAllMocks();
});

it("root access and the assembled Layer preserve the complete owner service union", () => {
  expectTypeOf<RootAccess>().toEqualTypeOf<
    Effect.Effect<Context.Context<InfrastructureServices>, InfrastructureError>
  >();
  expectTypeOf<ReturnType<typeof provideInfrastructure>>().toEqualTypeOf<
    Layer.Layer<InfrastructureServices, InfrastructureError>
  >();
  expectTypeOf<RootAccess>().not.toEqualTypeOf<
    Effect.Effect<Context.Context<unknown>, InfrastructureError>
  >();
});

it.effect(
  "constructors cannot read root services before assembly and later reads share the completed Context",
  () =>
    Effect.gen(function* () {
      const reads: RootAccess[] = [];
      const earlyErrors: InfrastructureError[] = [];
      vi.spyOn(ExtensionActivationService, "make").mockImplementation(
        (extensions, adapters, policy, read) =>
          Effect.gen(function* () {
            reads.push(read);
            const error = yield* Effect.flip(read).pipe(Effect.orDie);
            earlyErrors.push(error);
            return yield* originalMake(extensions, adapters, policy, read);
          })
      );
      const services = yield* Layer.build(provideInfrastructure());
      assert.equal(earlyErrors.length, 1);
      assert.ok(earlyErrors[0] instanceof InfrastructureError);
      assert.equal(earlyErrors[0].phase, LifecyclePhase.Providers);
      assert.match(earlyErrors[0].message, /unavailable during assembly/);
      const root = yield* reads[0]!;
      assert.equal(yield* reads[0]!, root);
      assert.equal(Context.get(root, LIFETIME_POLICY), Context.get(services, LIFETIME_POLICY));
      assert.equal(Context.get(root, TEMPORAL_SERVICE), Context.get(services, TEMPORAL_SERVICE));
      assert.equal(Context.get(root, ID_SERVICE), Context.get(services, ID_SERVICE));
      assert.equal(
        Context.get(root, EXTENSION_REGISTRY),
        Context.get(services, EXTENSION_REGISTRY)
      );
      assert.equal(Context.get(root, ADAPTER_REGISTRY), Context.get(services, ADAPTER_REGISTRY));
      assert.equal(
        Context.get(root, EXTENSION_ACTIVATION),
        Context.get(services, EXTENSION_ACTIVATION)
      );
      assert.equal(
        Context.get(root, EXTENSION_LIFECYCLE),
        Context.get(services, EXTENSION_LIFECYCLE)
      );
      assert.equal(Context.get(root, ADAPTER_RESOLVER), Context.get(services, ADAPTER_RESOLVER));
      assert.equal(Context.get(root, LOCATION_BEHAVIOR), Context.get(services, LOCATION_BEHAVIOR));
      assert.equal(Context.get(root, EXTENSION_LIFECYCLE).snapshot, LifecycleStatus.New);
    })
);

class LOCAL extends Context.Service<LOCAL, { value: string }>()("synthetic.root-context-local") {}
it.effect(
  "lazy Layers and activation see fixed root overrides after the complete graph is published",
  () =>
    Effect.gen(function* () {
      const instant = Temporal.Instant.from("2026-10-17T00:00:00Z");
      const rootIds = { uuidV7: () => Effect.succeed("root-id") };
      const rootClock = { now: () => Effect.succeed(instant) };
      let loads = 0;
      const seen: string[] = [];
      const item = extension("typed-root", {
        load: () =>
          Effect.sync(() => {
            loads++;
            return defineExtensionModule({
              layer: Layer.mergeAll(
                Layer.succeed(ID_SERVICE, { uuidV7: () => Effect.succeed("local-id") }),
                Layer.succeed(TEMPORAL_SERVICE, {
                  now: () => Effect.die("Unexpected local clock")
                }),
                Layer.effect(
                  LOCAL,
                  Effect.gen(function* () {
                    assert.equal(yield* ID_SERVICE, rootIds);
                    assert.equal(yield* TEMPORAL_SERVICE, rootClock);
                    yield* LOCATION_BEHAVIOR;
                    yield* ADAPTER_RESOLVER;
                    yield* EXTENSION_LIFECYCLE;
                    yield* EXTENSION_REGISTRY;
                    yield* ADAPTER_REGISTRY;
                    yield* EXTENSION_ACTIVATION;
                    yield* LIFETIME_POLICY;
                    yield* Effect.yieldNow;
                    const value = yield* (yield* ID_SERVICE).uuidV7();
                    seen.push(value);
                    return { value };
                  })
                )
              ),
              activate: (context) =>
                Effect.gen(function* () {
                  assert.equal(yield* ID_SERVICE, rootIds);
                  assert.equal(yield* TEMPORAL_SERVICE, rootClock);
                  assert.equal(yield* (yield* TEMPORAL_SERVICE).now(), instant);
                  const service = yield* LOCAL;
                  yield* context.registerAdapter("typed-root.adapter", port, {
                    run: () => Effect.succeed(service.value)
                  });
                })
            });
          })
      });
      const env = yield* setup(
        [item],
        {},
        undefined,
        Layer.merge(provideIdService(rootIds), provideTemporalService(rootClock))
      );
      assert.equal(loads, 0);
      assert.deepEqual(seen, []);
      yield* env.lifecycle.prepared;
      assert.equal(loads, 0);
      const plan = yield* env.adapterResolver
        .resolve([request])
        .pipe(Effect.provideService(ID_SERVICE, { uuidV7: () => Effect.succeed("caller-id") }));
      assert.equal(loads, 1);
      assert.deepEqual(seen, ["root-id"]);
      assert.equal(
        yield* env.adapterResolver.implementation(plan.resolvedAdapters[0]!, port).run(),
        "root-id"
      );
    })
);
