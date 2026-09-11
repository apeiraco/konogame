import { lstat, open, opendir } from "node:fs/promises";
import {
  type DiscoveryDirectoryEntry,
  DiscoveryEntryKind,
  type DiscoveryFileInfo,
  type DiscoveryFileSystem,
  DiscoveryFileSystemError
} from "@konogame/game";
import { Effect } from "effect";

const failure = (operation: string, cause: unknown) =>
  new DiscoveryFileSystemError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    code: cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined
  });
const io = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(operation, cause) });

export class NodeDiscoveryFileSystem implements DiscoveryFileSystem {
  inspect(path: string): Effect.Effect<DiscoveryFileInfo, DiscoveryFileSystemError> {
    return io("inspect", () => lstat(path, { bigint: true })).pipe(
      Effect.map((info) => ({
        kind: info.isSymbolicLink()
          ? DiscoveryEntryKind.Link
          : info.isDirectory()
            ? DiscoveryEntryKind.Directory
            : info.isFile()
              ? DiscoveryEntryKind.File
              : DiscoveryEntryKind.Other,
        size: Number(info.size),
        identity: `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`
      }))
    );
  }

  list(
    path: string,
    limit: number
  ): Effect.Effect<DiscoveryDirectoryEntry[], DiscoveryFileSystemError> {
    return Effect.acquireUseRelease(
      io("open-directory", () => opendir(path)),
      (directory) =>
        Effect.gen(function* () {
          const entries: DiscoveryDirectoryEntry[] = [];
          while (true) {
            const entry = yield* io("read-directory", () => directory.read());
            if (!entry) break;
            if (entries.length >= limit)
              return yield* Effect.fail(
                failure("list", `Directory entry limit exceeded: ${limit}`)
              );
            entries.push({
              name: entry.name,
              kind: entry.isSymbolicLink()
                ? DiscoveryEntryKind.Link
                : entry.isDirectory()
                  ? DiscoveryEntryKind.Directory
                  : entry.isFile()
                    ? DiscoveryEntryKind.File
                    : DiscoveryEntryKind.Other
            });
          }
          return entries.sort((left, right) => left.name.localeCompare(right.name));
        }),
      (directory) => io("close-directory", () => directory.close())
    );
  }

  readText(path: string, maxBytes: number): Effect.Effect<string, DiscoveryFileSystemError> {
    const self = this;
    return Effect.gen(function* () {
      const before = yield* self.inspect(path);
      if (before.kind !== DiscoveryEntryKind.File || before.size > maxBytes)
        return yield* Effect.fail(
          failure("read-text", `Expected a regular file of at most ${maxBytes} bytes`)
        );
      return yield* Effect.acquireUseRelease(
        io("open-file", () => open(path, "r")),
        (handle) =>
          Effect.gen(function* () {
            const info = yield* io("inspect-file", () => handle.stat({ bigint: true }));
            if (
              `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}` !==
              before.identity
            )
              return yield* Effect.fail(
                failure("read-text", "Discovery file changed before reading")
              );
            const buffer = Buffer.alloc(maxBytes + 1);
            let length = 0;
            while (length < buffer.length) {
              const result = yield* io("read-file", () =>
                handle.read(buffer, length, buffer.length - length, length)
              );
              if (!result.bytesRead) break;
              length += result.bytesRead;
            }
            if (length > maxBytes)
              return yield* Effect.fail(
                failure("read-text", "Discovery file exceeds the byte limit")
              );
            if ((yield* self.inspect(path)).identity !== before.identity)
              return yield* Effect.fail(
                failure("read-text", "Discovery file changed while reading")
              );
            return yield* Effect.try({
              try: () =>
                new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)),
              catch: (cause) => failure("decode-text", cause)
            });
          }),
        (handle) => io("close-file", () => handle.close())
      );
    });
  }
}

