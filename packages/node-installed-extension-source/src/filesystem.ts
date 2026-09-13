import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, opendir, realpath, stat } from "node:fs/promises";
import { Context, Data, Effect, Layer, Stream } from "effect";
import { EXTENSION_PACKAGE_BYTE_LIMIT, EXTENSION_PACKAGE_COUNT_LIMIT } from "./package.ts";

export class InstalledExtensionError extends Data.TaggedError("InstalledExtensionError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  static from(operation: string, cause: unknown): InstalledExtensionError {
    return new InstalledExtensionError({
      operation,
      cause,
      message: cause instanceof Error ? cause.message : String(cause)
    });
  }
}
const io = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => InstalledExtensionError.from(operation, cause)
  });

export interface InstalledExtensionFileSystem {
  realPath(path: string): Effect.Effect<string, InstalledExtensionError>;
  directories(path: string): Effect.Effect<readonly string[], InstalledExtensionError>;
  manifest(path: string): Effect.Effect<Uint8Array, InstalledExtensionError>;
  entryHash(path: string): Effect.Effect<string, InstalledExtensionError>;
}
export class INSTALLED_EXTENSION_FILESYSTEM extends Context.Service<
  INSTALLED_EXTENSION_FILESYSTEM,
  InstalledExtensionFileSystem
>()("node.installed-extension-filesystem") {}

export class NodeInstalledExtensionFileSystem implements InstalledExtensionFileSystem {
  realPath(path: string) {
    return io("realpath", () => realpath(path));
  }

  directories(path: string): Effect.Effect<readonly string[], InstalledExtensionError> {
    return Effect.acquireUseRelease(
      io("open-directory", () => opendir(path)),
      (directory) =>
        Effect.gen(function* () {
          const entries: string[] = [];
          while (true) {
            const entry = yield* io("read-directory", () => directory.read());
            if (!entry) {
              break;
            }
            if (!entry.isDirectory() && !entry.isSymbolicLink()) {
              continue;
            }
            entries.push(entry.name);
            if (entries.length > EXTENSION_PACKAGE_COUNT_LIMIT) {
              return yield* Effect.fail(
                InstalledExtensionError.from(
                  "read-directory",
                  `Installed extension package limit is ${EXTENSION_PACKAGE_COUNT_LIMIT}`
                )
              );
            }
          }
          return entries.sort();
        }),
      (directory) => io("close-directory", () => directory.close())
    );
  }

  manifest(path: string): Effect.Effect<Uint8Array, InstalledExtensionError> {
    return Effect.acquireUseRelease(
      io("open-manifest", () => open(path, "r")),
      (file) =>
        Effect.gen(function* () {
          const info = yield* io("inspect-manifest", () => file.stat());
          if (!info.isFile() || info.size > EXTENSION_PACKAGE_BYTE_LIMIT) {
            return yield* Effect.fail(
              InstalledExtensionError.from(
                "inspect-manifest",
                `Extension manifest must be a regular file of at most ${EXTENSION_PACKAGE_BYTE_LIMIT} bytes`
              )
            );
          }
          const buffer = Buffer.alloc(EXTENSION_PACKAGE_BYTE_LIMIT + 1);
          let length = 0;
          while (length < buffer.length) {
            const result = yield* io("read-manifest", () =>
              file.read(buffer, length, buffer.length - length, length)
            );
            if (!result.bytesRead) {
              break;
            }
            length += result.bytesRead;
          }
          if (length > EXTENSION_PACKAGE_BYTE_LIMIT) {
            return yield* Effect.fail(
              InstalledExtensionError.from("read-manifest", "Extension manifest exceeds byte limit")
            );
          }
          return buffer.subarray(0, length);
        }),
      (file) => io("close-manifest", () => file.close())
    );
  }

  entryHash(path: string): Effect.Effect<string, InstalledExtensionError> {
    return Effect.gen(function* () {
      if (!(yield* io("inspect-entry", () => stat(path))).isFile()) {
        return yield* Effect.fail(
          InstalledExtensionError.from("hash-entry", "Extension entry must be a regular file")
        );
      }
      const hash = createHash("sha256");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const input = yield* Effect.acquireRelease(
            Effect.sync(() => createReadStream(path)),
            (stream) =>
              Effect.promise(
                () =>
                  new Promise<void>((resolve) => {
                    if (stream.closed) {
                      resolve();
                      return;
                    }
                    const ignoreError = () => {};
                    stream.once("close", () => {
                      stream.off("error", ignoreError);
                      resolve();
                    });
                    stream.on("error", ignoreError);
                    if (!stream.destroyed) {
                      stream.destroy();
                    }
                  })
              )
          );
          yield* Stream.runForEach(
            Stream.fromAsyncIterable(input.iterator({ destroyOnReturn: false }), (cause) =>
              InstalledExtensionError.from("read-entry", cause)
            ),
            (chunk) =>
              Effect.sync(() => {
                hash.update(chunk);
              })
          );
        })
      );
      return hash.digest("hex");
    });
  }
}

export const installedExtensionFileSystemLayer = Layer.succeed(
  INSTALLED_EXTENSION_FILESYSTEM,
  new NodeInstalledExtensionFileSystem()
);
