import { isAbsolute, resolve } from "node:path";
import { type IdService } from "@konogame/infrastructure";
import { ConfigurationInputKind, type WorkspaceConfigurationError } from "@konogame/workspace";
import { Effect } from "effect";
import { loadConfigurationState } from "../operations/configuration.ts";
import { ConfigurationInvalidInputError } from "../operations/errors.ts";
import {
  ImportPathKind,
  type WorkspaceImportFileSystem,
  type WorkspaceImportState
} from "../operations/import.ts";
import { WORKSPACE_NODE_FILESYSTEM, type WorkspaceNodeFileSystem } from "./node.ts";

export class NodeWorkspaceImportFileSystem implements WorkspaceImportFileSystem {
  readonly processId: number;
  constructor(
    protected readonly node: WorkspaceNodeFileSystem,
    private readonly ids: IdService
  ) {
    this.processId = node.processId;
  }

  canonicalRoot(path: string) {
    const self = this;
    return Effect.gen(function* () {
      if (!isAbsolute(path)) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            { kind: ConfigurationInputKind.Root, path },
            "Workspace root must be absolute"
          )
        );
      }
      const canonical = yield* self.node.realPath(resolve(path));
      if ((yield* self.inspect(canonical)) !== ImportPathKind.Directory) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            { kind: ConfigurationInputKind.Root, path },
            "Workspace root must resolve to a directory"
          )
        );
      }
      return canonical;
    });
  }
  inspect(path: string) {
    return this.node.stat(path).pipe(
      Effect.map((info) =>
        info.isSymbolicLink()
          ? ImportPathKind.Other
          : info.isFile()
            ? ImportPathKind.File
            : info.isDirectory()
              ? ImportPathKind.Directory
              : ImportPathKind.Other
      ),
      Effect.catch((error) =>
        error.code === "ENOENT" ? Effect.succeed(undefined) : Effect.fail(error)
      )
    );
  }
  read(path: string, maxBytes: number) {
    return this.node.readBounded(path, maxBytes);
  }
  create(path: string, content: string) {
    const self = this;
    return Effect.gen(function* () {
      const temporary = `${path}.pending-${yield* self.ids.uuidV7()}`;
      let owned = false;
      return yield* self.node
        .writeExclusive(temporary, content, () => {
          owned = true;
        })
        .pipe(
          Effect.andThen(() => self.node.link(temporary, path)),
          Effect.onExit(() => (owned ? self.node.remove(temporary) : Effect.void))
        );
    });
  }
  mkdir(path: string) {
    return this.node
      .mkdir(path)
      .pipe(Effect.catch((error) => (error.code === "EEXIST" ? Effect.void : Effect.fail(error))));
  }
  remove(path: string) {
    return this.node.remove(path);
  }
  processAlive(pid: number) {
    return this.node.processAlive(pid);
  }
  readWorkspace(root: string): Effect.Effect<WorkspaceImportState, WorkspaceConfigurationError> {
    return loadConfigurationState(root).pipe(
      Effect.provideService(WORKSPACE_NODE_FILESYSTEM, this.node)
    );
  }
}
