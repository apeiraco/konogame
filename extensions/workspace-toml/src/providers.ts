import { type DiscoveryBatch, type ExtensionDiscoverySource } from "@konogame/infrastructure";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { workspaceTomlManifest } from "./manifest.ts";

export function workspaceTomlExtensionSource(): ExtensionDiscoverySource {
  const batch: DiscoveryBatch = {
    complete: true,
    contributions: [
      {
        kind: AdapterOwnerKind.Extension,
        manifest: workspaceTomlManifest,
        load: () =>
          Effect.tryPromise(() => import("./module.ts")).pipe(
            Effect.map(({ createWorkspaceTomlExtensionModule }) =>
              createWorkspaceTomlExtensionModule()
            )
          )
      }
    ]
  };
  return {
    id: "extension:workspace-toml",
    discover: () => Effect.succeed(batch)
  };
}
