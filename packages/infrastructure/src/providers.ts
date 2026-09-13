import { Context, Deferred, Effect, Layer, Option } from "effect";
import { ADAPTER_RESOLVER, AdapterResolver } from "./adapter-resolution/service.ts";
import { EXTENSION_ACTIVATION, ExtensionActivationService } from "./extension/activation.ts";
import { InfrastructureError, infrastructureTry, LifecyclePhase } from "./extension/diagnostics.ts";
import { type ExtensionDiscoverySource } from "./extension/discovery.ts";
import { EXTENSION_LIFECYCLE, ExtensionLifecycle } from "./extension/lifecycle.ts";
import {
  type InfrastructureSettings,
  LIFETIME_POLICY,
  LifetimePolicy
} from "./extension/lifetime.ts";
import { ID_SERVICE, UuidIdService } from "./id.ts";
import { LOCATION_BEHAVIOR, LocationBehaviorService } from "./location/behavior.ts";
import { ADAPTER_REGISTRY, AdapterRegistry } from "./registry/adapter-registry.ts";
import { EXTENSION_REGISTRY, ExtensionRegistry } from "./registry/extension-registry.ts";
import { SystemTemporalService, TEMPORAL_SERVICE } from "./time.ts";

export type InfrastructureServices =
  | LIFETIME_POLICY
  | TEMPORAL_SERVICE
  | ID_SERVICE
  | EXTENSION_REGISTRY
  | ADAPTER_REGISTRY
  | EXTENSION_ACTIVATION
  | EXTENSION_LIFECYCLE
  | ADAPTER_RESOLVER
  | LOCATION_BEHAVIOR;

export function provideInfrastructure(
  settings: InfrastructureSettings = {},
  sources: readonly ExtensionDiscoverySource[] = []
): Layer.Layer<InfrastructureServices, InfrastructureError> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const incoming = yield* Effect.context<never>();
      const policy = yield* infrastructureTry(
        LifecyclePhase.Registration,
        () => new LifetimePolicy(settings)
      );
      const extensions = yield* ExtensionRegistry.make();
      const adapters = yield* AdapterRegistry.make(extensions);
      const completedServices = yield* Deferred.make<Context.Context<InfrastructureServices>>();
      const readServices = Effect.gen(function* () {
        const completed = yield* Deferred.poll(completedServices);
        if (Option.isNone(completed)) {
          return yield* Effect.fail(
            new InfrastructureError({
              phase: LifecyclePhase.Providers,
              message: "Infrastructure services are unavailable during assembly"
            })
          );
        }
        return yield* completed.value;
      });
      const activation = yield* ExtensionActivationService.make(
        extensions,
        adapters,
        policy,
        readServices
      );
      const lifecycle = yield* ExtensionLifecycle.make(
        extensions,
        adapters,
        activation,
        sources,
        policy
      );
      const adapterResolver = new AdapterResolver(lifecycle, extensions, adapters, activation);
      const locations = new LocationBehaviorService(adapterResolver);
      const services = Context.empty().pipe(
        Context.add(LIFETIME_POLICY, policy),
        Context.add(
          TEMPORAL_SERVICE,
          Context.getOrElse(incoming, TEMPORAL_SERVICE, () => new SystemTemporalService())
        ),
        Context.add(
          ID_SERVICE,
          Context.getOrElse(incoming, ID_SERVICE, () => new UuidIdService())
        ),
        Context.add(EXTENSION_REGISTRY, extensions),
        Context.add(ADAPTER_REGISTRY, adapters),
        Context.add(EXTENSION_ACTIVATION, activation),
        Context.add(EXTENSION_LIFECYCLE, lifecycle),
        Context.add(ADAPTER_RESOLVER, adapterResolver),
        Context.add(LOCATION_BEHAVIOR, locations),
        Context.merge(incoming)
      );
      yield* Effect.addFinalizer(() => lifecycle.release);
      yield* Deferred.succeed(completedServices, services);
      return services;
    })
  );
}
