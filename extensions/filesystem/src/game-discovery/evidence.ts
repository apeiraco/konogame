import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  DiscoveryEntryKind,
  type DiscoveryFileInfo,
  type DiscoveryFileSystem,
  DiscoveryFileSystemError
} from "@konogame/game";
import { Effect, Fiber } from "effect";

const failure = (operation: string, cause: unknown) =>
  new DiscoveryFileSystemError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
    code: cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined
  });

export function discoveryDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function inspectDiscoveryPath(
  fileSystem: DiscoveryFileSystem,
  input: string,
  expected: DiscoveryEntryKind
): Effect.Effect<DiscoveryFileInfo, DiscoveryFileSystemError> {
  return Effect.gen(function* () {
    if (!isAbsolute(input))
      return yield* Effect.fail(failure("inspect-path", "Discovery paths must be absolute"));
    const path = resolve(input);
    const parents: string[] = [];
    let parent = dirname(path);
    while (parent !== dirname(parent)) {
      parents.unshift(parent);
      parent = dirname(parent);
    }
    parents.unshift(parent);
    yield* Effect.forEach(parents, (component) =>
      fileSystem.inspect(component).pipe(
        Effect.filterOrFail(
          (info) => info.kind === DiscoveryEntryKind.Directory,
          () =>
            failure(
              "inspect-path",
              `Discovery directory links and special files are forbidden: ${component}`
            )
        )
      )
    );
    const info = yield* fileSystem.inspect(path);
    if (info.kind !== expected)
      return yield* Effect.fail(
        failure("inspect-path", `Expected ${expected}; links are forbidden: ${path}`)
      );
    return info;
  });
}

export function directoryEvidence(
  fileSystem: DiscoveryFileSystem,
  path: string,
  limit = 4096
): Effect.Effect<string, DiscoveryFileSystemError> {
  return Effect.gen(function* () {
    const info = yield* inspectDiscoveryPath(fileSystem, path, DiscoveryEntryKind.Directory);
    const entries = yield* fileSystem.list(path, limit);
    // Fork on this fiber. A completed collector would interrupt the children before they are joined.
    const fibers = [];
    for (const entry of entries)
      fibers.push(yield* Effect.forkChild(fileSystem.inspect(join(path, entry.name))));
    const inspected = yield* Fiber.joinAll(fibers);
    const observed = entries.map((entry, index) => {
      const item = inspected[index]!;
      return [entry.name, item.kind, item.identity];
    });
    if ((yield* fileSystem.inspect(path)).identity !== info.identity)
      return yield* Effect.fail(
        failure("directory-evidence", "Discovery directory changed while reading")
      );
    return discoveryDigest(JSON.stringify([info.identity, observed]));
  });
}

