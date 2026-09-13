import { type Stats } from "node:fs";
import {
  link as nativeLink,
  lstat as nativeLstat,
  mkdir as nativeMkdir,
  open as nativeOpen,
  readdir as nativeReaddir,
  readFile as nativeReadFile,
  realpath as nativeRealpath,
  rename as nativeRename,
  unlink as nativeUnlink
} from "node:fs/promises";
import {
  ConfigurationInputKind,
  ConfigurationLayoutProblem,
  type WorkspaceConfigurationError,
  WorkspaceConflictError,
  WorkspaceConflictKind,
  type WorkspaceFileSystemFailure
} from "@konogame/workspace";
import { Context, Data, Effect, Layer } from "effect";
import {
  ConfigurationInvalidInputError,
  configurationRule,
  decodeConfigurationText
} from "../operations/errors.ts";

export class WorkspaceFileSystemError
  extends Data.TaggedError("WorkspaceFileSystemError")<{
    readonly operation: string;
    readonly message: string;
    readonly cause?: unknown;
    readonly code?: string;
  }>
  implements WorkspaceFileSystemFailure
{
  static from(operation: string, cause: unknown): WorkspaceFileSystemError {
    return new WorkspaceFileSystemError({
      operation,
      cause,
      message: cause instanceof Error ? cause.message : String(cause),
      code: cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined
    });
  }
}
const io = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => WorkspaceFileSystemError.from(operation, cause)
  });

export interface WorkspaceNodeFileSystem {
  readonly processId: number;
  processAlive(pid: number): Effect.Effect<boolean, WorkspaceFileSystemError>;
  stat(path: string): Effect.Effect<Stats, WorkspaceFileSystemError>;
  list(path: string): Effect.Effect<string[], WorkspaceFileSystemError>;
  realPath(path: string): Effect.Effect<string, WorkspaceFileSystemError>;
  readBytes(path: string): Effect.Effect<Buffer, WorkspaceFileSystemError>;
  readText(path: string): Effect.Effect<string, WorkspaceFileSystemError>;
  readBounded(path: string, maxBytes: number): Effect.Effect<string, WorkspaceConfigurationError>;
  mkdir(path: string): Effect.Effect<void, WorkspaceFileSystemError>;
  remove(path: string): Effect.Effect<void, WorkspaceFileSystemError>;
  move(from: string, to: string): Effect.Effect<void, WorkspaceFileSystemError>;
  link(from: string, to: string): Effect.Effect<void, WorkspaceFileSystemError>;
  writeExclusive(
    path: string,
    content: string,
    onCreated?: () => void
  ): Effect.Effect<void, WorkspaceFileSystemError>;
}
export class WORKSPACE_NODE_FILESYSTEM extends Context.Service<
  WORKSPACE_NODE_FILESYSTEM,
  WorkspaceNodeFileSystem
>()("workspace-toml.node-filesystem") {}

export class NodeWorkspaceFileSystem implements WorkspaceNodeFileSystem {
  readonly processId = process.pid;
  processAlive(pid: number) {
    return Effect.try({
      try: () => {
        process.kill(pid, 0);
        return true;
      },
      catch: (cause) => WorkspaceFileSystemError.from("process-alive", cause)
    }).pipe(
      Effect.catch((error) =>
        error.code === "ESRCH" ? Effect.succeed(false) : Effect.succeed(true)
      )
    );
  }
  stat(path: string) {
    return io("stat", () => nativeLstat(path));
  }
  list(path: string) {
    return io("list", () => nativeReaddir(path));
  }
  realPath(path: string) {
    return io("realpath", () => nativeRealpath(path));
  }
  readBytes(path: string) {
    return io("read-file", (signal) => nativeReadFile(path, { signal }));
  }
  readText(path: string) {
    return io("read-file", (signal) => nativeReadFile(path, { encoding: "utf8", signal }));
  }
  mkdir(path: string) {
    return io("mkdir", () => nativeMkdir(path)).pipe(Effect.uninterruptible);
  }
  remove(path: string) {
    return io("unlink", () => nativeUnlink(path)).pipe(Effect.uninterruptible);
  }
  move(from: string, to: string) {
    return io("rename", () => nativeRename(from, to)).pipe(Effect.uninterruptible);
  }
  link(from: string, to: string) {
    return io("link", () => nativeLink(from, to)).pipe(Effect.uninterruptible);
  }
  writeExclusive(path: string, content: string, onCreated?: () => void) {
    return Effect.acquireUseRelease(
      io("open-exclusive", () => nativeOpen(path, "wx")),
      (handle) =>
        Effect.gen(function* () {
          yield* Effect.sync(() => {
            onCreated?.();
          });
          yield* io("write-file", () => handle.writeFile(content));
          yield* io("sync-file", () => handle.sync());
        }),
      (handle) => io("close-file", () => handle.close())
    ).pipe(Effect.uninterruptible);
  }
  readBounded(path: string, maxBytes: number) {
    return Effect.gen(function* () {
      const info = yield* io("stat", () => nativeLstat(path));
      if (!info.isFile() || info.isSymbolicLink()) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.Layout,
              path: path,
              problem: info.isSymbolicLink()
                ? ConfigurationLayoutProblem.Link
                : ConfigurationLayoutProblem.NotFile
            },
            "Invalid import metadata file"
          )
        );
      }
      if (info.size > maxBytes) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            { kind: ConfigurationInputKind.RecordSize, limit: maxBytes, actual: info.size },
            "Import metadata exceeds byte limit"
          )
        );
      }
      return yield* Effect.acquireUseRelease(
        io("open-read", () => nativeOpen(path, "r")),
        (handle) =>
          Effect.gen(function* () {
            const opened = yield* io("stat-opened", () => handle.stat());
            if (opened.dev !== info.dev || opened.ino !== info.ino) {
              return yield* Effect.fail(
                new WorkspaceConflictError({
                  issue: { kind: WorkspaceConflictKind.ExternalChange, path, phase: "read" },
                  message: "Import metadata changed before reading"
                })
              );
            }
            let bytes = Buffer.allocUnsafe(Math.min(maxBytes + 1, Math.max(opened.size + 1, 4096)));
            let length = 0;
            while (length <= maxBytes) {
              if (length === bytes.length) {
                const next = Buffer.allocUnsafe(Math.min(maxBytes + 1, bytes.length * 2));
                bytes.copy(next, 0, 0, length);
                bytes = next;
              }
              const result = yield* io("read", () =>
                handle.read(bytes, length, bytes.length - length, length)
              );
              if (!result.bytesRead) {
                break;
              }
              length += result.bytesRead;
            }
            if (length > maxBytes) {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  { kind: ConfigurationInputKind.RecordSize, limit: maxBytes, actual: length },
                  "Import metadata exceeds byte limit"
                )
              );
            }
            return yield* configurationRule(
              "decode",
              decodeConfigurationText,
              bytes.subarray(0, length),
              path
            );
          }),
        (handle) => io("close-file", () => handle.close())
      );
    });
  }
}
export const workspaceNodeFileSystemLayer = Layer.succeed(
  WORKSPACE_NODE_FILESYSTEM,
  new NodeWorkspaceFileSystem()
);

export const lstat = (path: string) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.stat(path));
export const readdir = (path: string) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.list(path));
export const realpath = (path: string) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.realPath(path));
export const mkdir = (path: string) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.mkdir(path));
export const unlink = (path: string) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.remove(path));
export const rename = (from: string, to: string) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.move(from, to));
export const writeExclusive = (path: string, content: string, onCreated?: () => void) =>
  WORKSPACE_NODE_FILESYSTEM.use((fileSystem) =>
    fileSystem.writeExclusive(path, content, onCreated)
  );
export function readFile(
  path: string
): Effect.Effect<Buffer, WorkspaceFileSystemError, WORKSPACE_NODE_FILESYSTEM>;
export function readFile(
  path: string,
  encoding: "utf8"
): Effect.Effect<string, WorkspaceFileSystemError, WORKSPACE_NODE_FILESYSTEM>;
export function readFile(path: string, encoding?: "utf8") {
  return encoding
    ? WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.readText(path))
    : WORKSPACE_NODE_FILESYSTEM.use((fileSystem) => fileSystem.readBytes(path));
}
