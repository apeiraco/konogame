import { type DiscoveryBatch, type ExtensionDiscoverySource } from "@konogame/infrastructure";
import { type SaveStorePort } from "@konogame/save";
import { Context, Effect } from "effect";
import { filesystemManifest } from "./manifest.ts";

export class FILESYSTEM_SAVE_STORE extends Context.Service<FILESYSTEM_SAVE_STORE, SaveStorePort>()(
  "filesystem.save-store"
) {}

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
        kind: "extension",
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
