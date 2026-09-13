import {
  ADAPTER_RESOLUTION_PLANNER,
  ADAPTER_RESOLVER,
  type AdapterResolutionPlanner,
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind,
  type AdapterResolver
} from "@konogame/infrastructure";
import { type Artifact } from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";
import { SaveFeature } from "../contract/ports.ts";
import { saveStoreImplementation } from "./implementation.ts";

export class SaveStoreWorkflow {
  constructor(
    private readonly plan: AdapterResolutionPlanner,
    private readonly adapterResolver: AdapterResolver
  ) {}

  storeSave(artifact: Artifact, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const plan = yield* this.plan.plan(
        [SaveFeature.Store],
        preferredAdapterId === undefined ? {} : { [SaveFeature.Store]: preferredAdapterId }
      );
      const resolvedAdapter = plan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: SaveFeature.Store,
              reason: plan.unavailable[0]?.reason
            },
            message: plan.unavailable[0]?.reason ?? "No save store adapter available",
            operation: "storeSave"
          })
        );
      }
      const store = this.adapterResolver.implementation(resolvedAdapter, saveStoreImplementation);
      if (!store) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Implementation,
              featureId: SaveFeature.Store,
              adapterId: resolvedAdapter.adapterId,
              operation: resolvedAdapter.operation
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active implementation`,
            operation: "storeSave"
          })
        );
      }
      return yield* store.put(artifact);
    });
  }
}

export class SAVE_STORE_WORKFLOW extends Context.Service<SAVE_STORE_WORKFLOW, SaveStoreWorkflow>()(
  "save.store-workflow"
) {}

export function provideSaveStoreWorkflow() {
  return Layer.effect(
    SAVE_STORE_WORKFLOW,
    Effect.gen(function* () {
      return new SaveStoreWorkflow(yield* ADAPTER_RESOLUTION_PLANNER, yield* ADAPTER_RESOLVER);
    })
  );
}
