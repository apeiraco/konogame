import { dirname, join } from "node:path";
import { WorkspaceConflictError, WorkspaceConflictKind } from "@konogame/workspace";
import { Effect } from "effect";
import { loadConfigurationState } from "../operations/configuration.ts";
import { type WorkspaceManagementFileSystem } from "../operations/management.ts";
import { CONFIGURATION_RECORD_BYTE_LIMIT } from "../toml/limits.ts";
import { NodeWorkspaceImportFileSystem } from "./import.ts";
import { WORKSPACE_NODE_FILESYSTEM } from "./node.ts";

export class NodeWorkspaceManagementFileSystem
  extends NodeWorkspaceImportFileSystem
  implements WorkspaceManagementFileSystem
{
  override readWorkspace(
    root: string,
    options?: { pendingHostContainer?: string; pendingHostContent?: string }
  ) {
    return loadConfigurationState(root, options).pipe(
      Effect.provideService(WORKSPACE_NODE_FILESYSTEM, this.node)
    );
  }
  reserveDirectory(path: string) {
    return this.node.mkdir(path);
  }
  replace(path: string, content: string, expectedContent: string, operationId: string) {
    const self = this;
    return Effect.gen(function* () {
      const temporary = join(dirname(path), `.konogame-edit-${operationId}.tmp`);
      if (yield* self.inspect(temporary)) {
        if ((yield* self.read(temporary, CONFIGURATION_RECORD_BYTE_LIMIT)) !== content) {
          return yield* Effect.fail(
            new WorkspaceConflictError({
              issue: { kind: WorkspaceConflictKind.ExternalChange, path, phase: "replace" },
              message: "Edit staging file changed externally"
            })
          );
        }
      } else {
        yield* self.create(temporary, content);
      }
      // The final content check bounds the external-editor race before native replacement.
      if ((yield* self.read(path, CONFIGURATION_RECORD_BYTE_LIMIT)) !== expectedContent) {
        return yield* Effect.fail(
          new WorkspaceConflictError({
            issue: { kind: WorkspaceConflictKind.ExternalChange, path, phase: "replace" },
            message: "Edit record changed before replacement"
          })
        );
      }
      yield* self.node.move(temporary, path);
    });
  }
  cleanReplacement(path: string, content: string, operationId: string) {
    const self = this;
    return Effect.gen(function* () {
      const temporary = join(dirname(path), `.konogame-edit-${operationId}.tmp`);
      if (!(yield* self.inspect(temporary))) {
        return;
      }
      if ((yield* self.read(temporary, CONFIGURATION_RECORD_BYTE_LIMIT)) !== content) {
        return yield* Effect.fail(
          new WorkspaceConflictError({
            issue: { kind: WorkspaceConflictKind.ExternalChange, path, phase: "replace" },
            message: "Edit staging file changed externally"
          })
        );
      }
      yield* self.node.remove(temporary);
    });
  }
}
