import {
  type AdapterResolutionPlan,
  type AdapterResolutionRequest,
  DECLARATION_PROTOCOL_VERSION,
  type ImplementationPort,
  LocationTypeStatus,
  locationContractSchema,
  type ModuleDescriptor,
  type ResolvedAdapter,
  selectAdapters
} from "@konogame/infrastructure/contracts";
import { Context, Effect } from "effect";
import { type ExtensionActivationService } from "../extension/activation.ts";
import { ActivationStatus } from "../extension/activation-contract.ts";
import {
  type InfrastructureError,
  infrastructureTry,
  LifecyclePhase
} from "../extension/diagnostics.ts";
import { type ExtensionLifecycle } from "../extension/lifecycle.ts";
import { type AdapterRegistry } from "../registry/adapter-registry.ts";
import { type ExtensionRegistry } from "../registry/extension-registry.ts";

export class ADAPTER_RESOLVER extends Context.Service<ADAPTER_RESOLVER, AdapterResolver>()(
  "infrastructure.adapter-resolver"
) {}

export class AdapterResolver {
  constructor(
    private readonly lifecycle: ExtensionLifecycle,
    private readonly extensions: ExtensionRegistry,
    private readonly adapters: AdapterRegistry,
    private readonly activation: ExtensionActivationService
  ) {}
  get prepared(): Effect.Effect<void, InfrastructureError> {
    return this.lifecycle.prepared;
  }
  modules(): readonly ModuleDescriptor[] {
    return this.extensions.modules();
  }
  features() {
    return this.modules().flatMap((module) => module.features);
  }
  implementation<T>(resolvedAdapter: ResolvedAdapter, port: ImplementationPort<T>): T {
    return this.adapters.implementation(resolvedAdapter, port);
  }
  resolve(
    requests: readonly AdapterResolutionRequest[]
  ): Effect.Effect<AdapterResolutionPlan, InfrastructureError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.prepared;
      yield* infrastructureTry(LifecyclePhase.Activation, () => {
        for (const request of requests) {
          for (const location of request.locations ?? []) {
            locationContractSchema.assert(location);
          }
        }
      });
      yield* this.activation.demand(requests);
      const resolvedAdapters: ResolvedAdapter[] = [];
      const unavailable: AdapterResolutionPlan["unavailable"][number][] = [];
      for (const request of requests) {
        const unsupported = request.locations
          ?.map((location) => this.extensions.checkLocation(location))
          .find((result) => result.status !== LocationTypeStatus.Supported);
        if (unsupported) {
          unavailable.push({
            feature: request.feature.id,
            port: request.feature.port,
            operation: request.feature.operation,
            reason: unsupported.reason!
          });
          continue;
        }
        const plan = selectAdapters([request], this.adapters.descriptors());
        const declared = plan.resolvedAdapters[0];
        if (!declared) {
          unavailable.push(...plan.unavailable);
          continue;
        }
        const source = this.adapters.contributionFor(declared.adapterId);
        if (!source) {
          unavailable.push({
            feature: request.feature.id,
            port: request.feature.port,
            operation: request.feature.operation,
            reason: `Missing contribution for Adapter ${declared.adapterId}`
          });
          continue;
        }
        const result = yield* this.activation.activate(source.id);
        if (result.status !== ActivationStatus.Active) {
          unavailable.push({
            feature: request.feature.id,
            port: request.feature.port,
            operation: request.feature.operation,
            reason: `Adapter ${declared.adapterId} activation failed: ${result.reason}`
          });
          continue;
        }
        const active = this.adapters.resolve([
          { ...request, preferredAdapterId: declared.adapterId }
        ]);
        resolvedAdapters.push(...active.resolvedAdapters);
        unavailable.push(...active.unavailable);
      }
      return {
        declarationProtocolVersion: DECLARATION_PROTOCOL_VERSION,
        resolvedAdapters,
        unavailable
      };
    });
  }
}
