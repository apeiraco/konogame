import {
  type DiscoveryBatch,
  defineExtensionModule,
  type ExtensionDiscoverySource
} from "@konogame/infrastructure";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { workspaceModule } from "./contracts.ts";

export function workspaceModuleSource(): ExtensionDiscoverySource {
  const batch: DiscoveryBatch = {
    complete: true,
    contributions: [
      {
        kind: AdapterOwnerKind.Module,
        manifest: workspaceModule,
        load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
      }
    ]
  };
  return {
    id: "module:workspace",
    discover: () => Effect.succeed(batch)
  };
}
