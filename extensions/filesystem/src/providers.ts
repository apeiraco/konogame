import { type DiscoveryBatch, type ExtensionDiscoverySource } from "@konogame/infrastructure";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { type SaveStorePort } from "@konogame/save/contracts";
import { Context, Effect } from "effect";
import { type DiscoveryFileSystem } from "./game-discovery/filesystem.ts";
import { filesystemManifest, filesystemSaveStoreAdapter } from "./manifest.ts";
import { type WorkspaceBrowseFileSystem } from "./workspace-browse/io.ts";
import { type WorkspaceBrowseAccessPolicy } from "./workspace-browse/policy.ts";

export { type DiscoveryFileSystem } from "./game-discovery/filesystem.ts";

export class FILESYSTEM_SAVE_STORE extends Context.Service<FILESYSTEM_SAVE_STORE, SaveStorePort>()(
  filesystemSaveStoreAdapter.id
) {}
export class GAME_DISCOVERY_FILESYSTEM extends Context.Service<
  GAME_DISCOVERY_FILESYSTEM,
  DiscoveryFileSystem
>()("filesystem.discovery-filesystem") {}

export class WORKSPACE_BROWSE_FILESYSTEM extends Context.Service<
  WORKSPACE_BROWSE_FILESYSTEM,
  WorkspaceBrowseFileSystem
>()("filesystem.workspace-browse-filesystem") {}

export class WORKSPACE_BROWSE_ACCESS_POLICY extends Context.Service<
  WORKSPACE_BROWSE_ACCESS_POLICY,
  WorkspaceBrowseAccessPolicy
>()("filesystem.workspace-browse-access-policy") {}

export interface FilesystemExtensionOptions {
  saveRoot: string;
}

export function filesystemExtensionSource(
  options: FilesystemExtensionOptions
): ExtensionDiscoverySource {
  const batch: DiscoveryBatch = {
    complete: true,
    contributions: [
      {
        kind: AdapterOwnerKind.Extension,
        manifest: filesystemManifest,
        load: () =>
          Effect.tryPromise(() => import("./index.ts")).pipe(
            Effect.map((module) => module.createFilesystemExtensionModule(options))
          )
      }
    ]
  };
  return {
    id: "extension:filesystem",
    discover: () => Effect.succeed(batch)
  };
}
