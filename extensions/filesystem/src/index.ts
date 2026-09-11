import { locationImplementation } from "@konogame/contracts";
import { GAME_DISCOVERY_FILESYSTEM, gameDiscoveryImplementation } from "@konogame/game";
import {
  defineExtensionModule,
  type ExtensionActivationContext,
  ID_SERVICE
} from "@konogame/infrastructure";
import { saveStoreImplementation } from "@konogame/save";
import { Effect, Layer, Option } from "effect";
import { FilesystemGameDiscovery } from "./game-discovery/adapter.ts";
import { NodeDiscoveryFileSystem } from "./game-discovery/io.ts";
import { FilesystemLocationBehavior } from "./location/behavior.ts";
import {
  filesystemGameDiscoveryAdapter,
  filesystemLocationAdapter,
  filesystemSaveStoreAdapter
} from "./manifest.ts";
import { FILESYSTEM_SAVE_STORE, type FilesystemExtensionOptions } from "./providers.ts";
import { FilesystemSaveStore } from "./save-store/store.ts";

export { FilesystemGameDiscovery } from "./game-discovery/adapter.ts";
export * from "./game-discovery/evidence.ts";
export * from "./game-discovery/io.ts";
export { FilesystemLocationBehavior } from "./location/behavior.ts";
export * from "./location/values.ts";
export * from "./manifest.ts";
export * from "./providers.ts";
export * from "./save-store/store.ts";

export function createFilesystemExtensionModule(options: FilesystemExtensionOptions) {
  const store = Layer.effect(
    FILESYSTEM_SAVE_STORE,
    Effect.gen(function* () {
      const replacement = yield* Effect.serviceOption(FILESYSTEM_SAVE_STORE);
      if (Option.isSome(replacement)) return replacement.value;
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
      store
    ),
    activate
  });
}

export function activate(context: ExtensionActivationContext) {
  return Effect.gen(function* () {
    const fileSystem = yield* GAME_DISCOVERY_FILESYSTEM;
    const store = yield* FILESYSTEM_SAVE_STORE;
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
  });
}
