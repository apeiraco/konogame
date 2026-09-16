import { gameDiscoveryImplementation } from "@konogame/game";
import {
  defineExtensionModule,
  type ExtensionActivationContext,
  ID_SERVICE
} from "@konogame/infrastructure";
import { locationImplementation } from "@konogame/infrastructure/contracts";
import { saveStoreImplementation } from "@konogame/save";
import { workspaceLocationBrowserImplementation } from "@konogame/workspace";
import { Effect, Layer, Option } from "effect";
import { FilesystemGameDiscovery } from "./game-discovery/adapter.ts";
import { NodeDiscoveryFileSystem } from "./game-discovery/io.ts";
import { FilesystemLocationBehavior } from "./location/behavior.ts";
import {
  filesystemGameDiscoveryAdapter,
  filesystemLocationAdapter,
  filesystemSaveStoreAdapter,
  filesystemWorkspaceLocationBrowserAdapter
} from "./manifest.ts";
import {
  FILESYSTEM_SAVE_STORE,
  type FilesystemExtensionOptions,
  GAME_DISCOVERY_FILESYSTEM,
  WORKSPACE_BROWSE_ACCESS_POLICY,
  WORKSPACE_BROWSE_FILESYSTEM
} from "./providers.ts";
import { FilesystemSaveStore } from "./save-store/store.ts";
import { FilesystemWorkspaceLocationBrowser } from "./workspace-browse/adapter.ts";
import { NodeWorkspaceBrowseFileSystem } from "./workspace-browse/io.ts";
import { ProcessWorkspaceBrowseAccessPolicy } from "./workspace-browse/policy.ts";

export { FilesystemGameDiscovery } from "./game-discovery/adapter.ts";
export * from "./game-discovery/evidence.ts";
export * from "./game-discovery/filesystem.ts";
export * from "./game-discovery/io.ts";
export * from "./game-discovery/scope.ts";
export { FilesystemLocationBehavior } from "./location/behavior.ts";
export * from "./location/values.ts";
export * from "./manifest.ts";
export * from "./providers.ts";
export * from "./save-store/store.ts";
export { FilesystemWorkspaceLocationBrowser } from "./workspace-browse/adapter.ts";
export * from "./workspace-browse/io.ts";
export * from "./workspace-browse/policy.ts";

export function createFilesystemExtensionModule(options: FilesystemExtensionOptions) {
  const store = Layer.effect(
    FILESYSTEM_SAVE_STORE,
    Effect.gen(function* () {
      const replacement = yield* Effect.serviceOption(FILESYSTEM_SAVE_STORE);
      if (Option.isSome(replacement)) {
        return replacement.value;
      }
      return new FilesystemSaveStore(options.saveRoot, yield* ID_SERVICE);
    })
  );
  return defineExtensionModule({
    layer: Layer.mergeAll(
      Layer.effect(
        GAME_DISCOVERY_FILESYSTEM,
        Effect.map(
          Effect.serviceOption(GAME_DISCOVERY_FILESYSTEM),
          Option.getOrElse(() => new NodeDiscoveryFileSystem())
        )
      ),
      store,
      Layer.effect(
        WORKSPACE_BROWSE_FILESYSTEM,
        Effect.map(
          Effect.serviceOption(WORKSPACE_BROWSE_FILESYSTEM),
          Option.getOrElse(() => new NodeWorkspaceBrowseFileSystem())
        )
      ),
      Layer.effect(
        WORKSPACE_BROWSE_ACCESS_POLICY,
        Effect.map(
          Effect.serviceOption(WORKSPACE_BROWSE_ACCESS_POLICY),
          Option.getOrElse(() => new ProcessWorkspaceBrowseAccessPolicy())
        )
      )
    ),
    activate
  });
}

export function activate(context: ExtensionActivationContext) {
  return Effect.gen(function* () {
    const [fileSystem, store, browseFileSystem, browseAccessPolicy] = yield* Effect.all([
      GAME_DISCOVERY_FILESYSTEM,
      FILESYSTEM_SAVE_STORE,
      WORKSPACE_BROWSE_FILESYSTEM,
      WORKSPACE_BROWSE_ACCESS_POLICY
    ]);
    yield* context.registerAdapter(filesystemSaveStoreAdapter.id, saveStoreImplementation, store);
    yield* context.registerAdapter(
      filesystemLocationAdapter.id,
      locationImplementation,
      new FilesystemLocationBehavior()
    );
    yield* context.registerAdapter(
      filesystemGameDiscoveryAdapter.id,
      gameDiscoveryImplementation,
      new FilesystemGameDiscovery(fileSystem)
    );
    yield* context.registerAdapter(
      filesystemWorkspaceLocationBrowserAdapter.id,
      workspaceLocationBrowserImplementation,
      new FilesystemWorkspaceLocationBrowser(browseFileSystem, browseAccessPolicy)
    );
  });
}
