import {
  type DiscoveryBatch,
  defineExtensionModule,
  type ExtensionDiscoverySource
} from "@konogame/infrastructure";
import { Effect } from "effect";
import { gameModule } from "./index.ts";

export function gameModuleSource(): ExtensionDiscoverySource {
  const batch: DiscoveryBatch = {
    complete: true,
    contributions: [
      {
        kind: "module",
        manifest: gameModule,
        load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
      }
    ]
  };
  return {
    id: "module:game",
    discover: () => Effect.succeed(batch)
  };
}
