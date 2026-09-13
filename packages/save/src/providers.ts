import {
  type DiscoveryBatch,
  defineExtensionModule,
  type ExtensionDiscoverySource
} from "@konogame/infrastructure";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { saveModule } from "./contracts.ts";

export function saveModuleSource(): ExtensionDiscoverySource {
  const batch: DiscoveryBatch = {
    complete: true,
    contributions: [
      {
        kind: AdapterOwnerKind.Module,
        manifest: saveModule,
        load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
      }
    ]
  };
  return {
    id: "module:save",
    discover: () => Effect.succeed(batch)
  };
}
