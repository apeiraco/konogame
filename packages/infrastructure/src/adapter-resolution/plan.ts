import {
  AdapterOwnerKind,
  type AdapterResolutionPlan,
  type AdapterResolutionRequest
} from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import { Context, Effect, Layer } from "effect";
import { FeatureNotFoundError, infrastructureRule } from "./errors.ts";
import { ADAPTER_RESOLVER, type AdapterResolver } from "./service.ts";

const text = type.string.atLeastLength(1);
export const adapterResolutionPlanSchema = type({
  "+": "reject",
  declarationProtocolVersion: text,
  resolvedAdapters: type({
    "+": "reject",
    feature: text,
    port: text,
    operation: text,
    adapterId: text,
    owner: type({
      "+": "reject",
      kind: type.enumerated(AdapterOwnerKind.Module, AdapterOwnerKind.Extension),
      id: text
    }),
    declarationProtocolRange: text,
    portVersion: text,
    portVersionRange: text,
    capabilities: text.array()
  }).array(),
  unavailable: type({
    "+": "reject",
    feature: text,
    port: text,
    operation: text,
    reason: text
  }).array()
}).onDeepUndeclaredKey("reject");

export class AdapterResolutionPlanner {
  constructor(private readonly adapterResolver: AdapterResolver) {}

  features() {
    return Effect.gen({ self: this }, function* () {
      yield* this.adapterResolver.prepared;
      return this.adapterResolver.features().map((feature) => feature.id);
    });
  }

  plan(
    featureIds: readonly string[],
    preferences: Readonly<Record<string, string>> = {},
    additionalCapabilities: Readonly<Record<string, readonly string[]>> = {}
  ) {
    return Effect.gen({ self: this }, function* () {
      yield* this.adapterResolver.prepared;
      const requests: AdapterResolutionRequest[] = yield* infrastructureRule("plan", () =>
        featureIds.map((id) => {
          const feature = this.adapterResolver.features().find((item) => item.id === id);
          if (!feature) {
            throw new FeatureNotFoundError({
              issue: { kind: "feature", id },
              message: `Unknown feature: ${id}`,
              operation: "plan"
            });
          }
          return {
            feature,
            preferredAdapterId: preferences[id],
            additionalCapabilities: additionalCapabilities[id]
          };
        })
      );
      return yield* this.adapterResolver.resolve(requests);
    });
  }
}

export class ADAPTER_RESOLUTION_PLANNER extends Context.Service<
  ADAPTER_RESOLUTION_PLANNER,
  AdapterResolutionPlanner
>()("infrastructure.adapter-resolution-planner") {}

export function provideAdapterResolutionPlanner() {
  return Layer.effect(
    ADAPTER_RESOLUTION_PLANNER,
    Effect.gen(function* () {
      return new AdapterResolutionPlanner(yield* ADAPTER_RESOLVER);
    })
  );
}

export { type AdapterResolutionPlan };
