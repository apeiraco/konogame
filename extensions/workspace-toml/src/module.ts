import {
  defineExtensionModule,
  type ExtensionActivationContext,
  ID_SERVICE,
  LOCATION_BEHAVIOR
} from "@konogame/infrastructure";
import { WORKSPACE_CONFIGURATION, workspaceConfigurationImplementation } from "@konogame/workspace";
import { Effect, Layer, Option } from "effect";
import { NodeWorkspaceImportFileSystem } from "./filesystem/import.ts";
import { NodeWorkspaceManagementFileSystem } from "./filesystem/management.ts";
import { NodeWorkspaceFileSystem, WORKSPACE_NODE_FILESYSTEM } from "./filesystem/node.ts";
import {
  WORKSPACE_IMPORT_FILESYSTEM,
  WORKSPACE_MANAGEMENT_FILESYSTEM
} from "./filesystem/tokens.ts";
import { workspaceTomlConfigurationAdapter } from "./manifest.ts";
import { TomlWorkspaceConfiguration } from "./operations/configuration.ts";

export function createWorkspaceTomlExtensionModule() {
  const node = Layer.effect(
    WORKSPACE_NODE_FILESYSTEM,
    Effect.map(
      Effect.serviceOption(WORKSPACE_NODE_FILESYSTEM),
      Option.getOrElse(() => new NodeWorkspaceFileSystem())
    )
  );
  const importIo = Layer.effect(
    WORKSPACE_IMPORT_FILESYSTEM,
    Effect.gen(function* () {
      const replacement = yield* Effect.serviceOption(WORKSPACE_IMPORT_FILESYSTEM);
      if (Option.isSome(replacement)) {
        return replacement.value;
      }
      return new NodeWorkspaceImportFileSystem(yield* WORKSPACE_NODE_FILESYSTEM, yield* ID_SERVICE);
    })
  );
  const managementIo = Layer.effect(
    WORKSPACE_MANAGEMENT_FILESYSTEM,
    Effect.gen(function* () {
      const replacement = yield* Effect.serviceOption(WORKSPACE_MANAGEMENT_FILESYSTEM);
      if (Option.isSome(replacement)) {
        return replacement.value;
      }
      return new NodeWorkspaceManagementFileSystem(
        yield* WORKSPACE_NODE_FILESYSTEM,
        yield* ID_SERVICE
      );
    })
  );
  const io = Layer.merge(importIo, managementIo).pipe(Layer.provideMerge(node));
  const configuration = Layer.effect(
    WORKSPACE_CONFIGURATION,
    Effect.gen(function* () {
      return new TomlWorkspaceConfiguration(
        yield* WORKSPACE_NODE_FILESYSTEM,
        yield* WORKSPACE_IMPORT_FILESYSTEM,
        yield* WORKSPACE_MANAGEMENT_FILESYSTEM,
        yield* LOCATION_BEHAVIOR,
        yield* ID_SERVICE
      );
    })
  );
  return defineExtensionModule({
    layer: configuration.pipe(Layer.provideMerge(io)),
    activate: (context: ExtensionActivationContext) =>
      Effect.gen(function* () {
        yield* context.registerAdapter(
          workspaceTomlConfigurationAdapter.id,
          workspaceConfigurationImplementation,
          yield* WORKSPACE_CONFIGURATION
        );
      })
  });
}
