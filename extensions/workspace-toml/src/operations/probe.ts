import { isAbsolute, join } from "node:path";
import {
  type WorkspaceConfigurationError,
  type WorkspaceProbeInput,
  type WorkspaceProbeResult,
  WorkspaceProbeStatus
} from "@konogame/workspace";
import { type } from "arktype";
import { Effect } from "effect";
import { type WorkspaceNodeFileSystem } from "../filesystem/node.ts";

const pathResource = type({ "+": "reject", path: "string > 0" });
const absentCodes = new Set(["ENOENT", "ENOTDIR"]);
const deniedCodes = new Set(["EACCES", "EPERM"]);

/**
 * The filesystem Extension owns the resource type this probe understands. It is imported lazily
 * so that reading a Workspace never requires the filesystem package to be loadable.
 */
const filesystemResources = Effect.tryPromise(
  () => import("@konogame/extension-filesystem/location")
).pipe(Effect.orElseSucceed(() => undefined));

/**
 * Checks for the `.konogame/workspace.toml` marker only. A present marker does not prove the
 * configuration is readable; the formal read decides that.
 */
export function probeConfiguration(
  fileSystem: WorkspaceNodeFileSystem,
  input: WorkspaceProbeInput
): Effect.Effect<WorkspaceProbeResult, WorkspaceConfigurationError> {
  return Effect.gen(function* () {
    const supported = yield* filesystemResources;
    const data = pathResource(input.resource.data);
    if (
      !supported ||
      input.resource.type !== supported.FilesystemResourceType.Path ||
      input.resource.schemaVersion !== supported.FILESYSTEM_PATH_RESOURCE_SCHEMA_V1 ||
      data instanceof type.errors ||
      !isAbsolute(data.path)
    ) {
      return {
        status: WorkspaceProbeStatus.Unsupported,
        reason: `Workspace TOML cannot probe resource ${input.resource.type}`
      };
    }
    const root = data.path;
    return yield* fileSystem.stat(join(root, ".konogame", "workspace.toml")).pipe(
      Effect.map(
        (stats): WorkspaceProbeResult =>
          stats.isFile()
            ? { status: WorkspaceProbeStatus.Present, root }
            : { status: WorkspaceProbeStatus.Absent, reason: "workspace.toml is not a file" }
      ),
      Effect.catchIf(
        (error) => error.code !== undefined && absentCodes.has(error.code),
        () => Effect.succeed({ status: WorkspaceProbeStatus.Absent })
      ),
      Effect.catchIf(
        (error) => error.code !== undefined && deniedCodes.has(error.code),
        (error) =>
          Effect.succeed({
            status: WorkspaceProbeStatus.Denied,
            reason: error.code ?? error.message
          })
      )
    );
  });
}
