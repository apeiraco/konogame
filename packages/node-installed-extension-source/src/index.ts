import { type ExtensionDiscoverySource } from "@konogame/infrastructure";
import { Effect } from "effect";
import { INSTALLED_EXTENSION_FILESYSTEM, InstalledExtensionError } from "./filesystem.ts";
import { type NodeInstalledExtensionOptions, NodeInstalledExtensionSource } from "./source.ts";

export * from "./filesystem.ts";
export * from "./package.ts";
export * from "./source.ts";

export function nodeInstalledExtensionsSource(
  options: NodeInstalledExtensionOptions
): Effect.Effect<
  ExtensionDiscoverySource,
  InstalledExtensionError,
  INSTALLED_EXTENSION_FILESYSTEM
> {
  return Effect.gen(function* () {
    const fileSystem = yield* INSTALLED_EXTENSION_FILESYSTEM;
    return yield* Effect.try({
      try: () => new NodeInstalledExtensionSource(options, fileSystem),
      catch: (cause) => InstalledExtensionError.from("configure-source", cause)
    });
  });
}
