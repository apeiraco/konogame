import {
  type DiscoveryBatch,
  defineExtensionModule,
  type ExtensionDiscoverySource
} from "@konogame/infrastructure";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { steamManifest } from "./manifest.ts";

export function steamExtensionSource(): ExtensionDiscoverySource {
  const batch: DiscoveryBatch = {
    complete: true,
    contributions: [
      {
        kind: AdapterOwnerKind.Extension,
        manifest: steamManifest,
        load: () =>
          Effect.tryPromise(() => import("./index.ts")).pipe(
            Effect.map(({ activate }) => defineExtensionModule({ activate }))
          )
      }
    ]
  };
  return {
    id: "extension:steam",
    discover: () => Effect.succeed(batch)
  };
}
