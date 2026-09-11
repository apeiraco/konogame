import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DiscoveryEntryKind,
  type DiscoveryFileSystem,
  GameDiscoveryError,
  type GameDiscoveryInput,
  type GameDiscoveryPort,
  type GameDiscoveryResult,
  GameSourceKind
} from "@konogame/game";
import { Effect } from "effect";
import { absoluteFilesystemLocation } from "../location/values.ts";
import { directoryEvidence, discoveryDigest, inspectDiscoveryPath } from "./evidence.ts";

export { filesystemGameDiscoveryAdapter } from "../manifest.ts";

const failure = (cause: unknown) =>
  new GameDiscoveryError({
    operation: "discover",
    cause,
    message: cause instanceof Error ? cause.message : String(cause)
  });

export class FilesystemGameDiscovery implements GameDiscoveryPort {
  constructor(private readonly fileSystem: DiscoveryFileSystem) {}

  discover(input: GameDiscoveryInput): Effect.Effect<GameDiscoveryResult, GameDiscoveryError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.try({
        try: () => {
          if (input.sourceKind !== GameSourceKind.Standalone)
            throw new Error("Filesystem discovery requires a standalone source");
          if (
            !Number.isInteger(input.scope.maxDepth) ||
            input.scope.maxDepth < 0 ||
            input.scope.maxDepth > 16
          )
            throw new Error("Discovery maxDepth must be an integer from 0 to 16");
          if (!input.scope.paths.length || input.scope.paths.some((path) => !isAbsolute(path)))
            throw new Error("Discovery requires explicit absolute paths");
          for (const exclusion of input.scope.exclude)
            if (
              !exclusion ||
              isAbsolute(exclusion) ||
              exclusion.split(/[\\/]/).some((part) => !part || part === ".." || part === ".")
            )
              throw new Error("Exclusions must be relative directory prefixes");
        },
        catch: failure
      });
      const output: GameDiscoveryResult = { candidates: [], diagnostics: [] };
      const seen = new Map<string, number>();
      const emitted = new Set<string>();
      yield* Effect.forEach(
        [...new Set(input.scope.paths.map((path) => resolve(path)))].sort(),
        (path) => self.scan(path, path, 0, input, output, seen, emitted)
      );
      return output;
    });
  }

  private scan(
    root: string,
    path: string,
    depth: number,
    input: GameDiscoveryInput,
    output: GameDiscoveryResult,
    seen: Map<string, number>,
    emitted: Set<string>
  ): Effect.Effect<void, GameDiscoveryError> {
    const self = this;
    return Effect.gen(function* () {
      const suffix = relative(root, path).split(sep).join("/");
      if (
        input.scope.exclude.some(
          (value) =>
            suffix === value.replaceAll("\\", "/") ||
            suffix.startsWith(`${value.replaceAll("\\", "/")}/`)
        )
      )
        return;
      const remainingDepth = input.scope.maxDepth - depth;
      const pathKey = process.platform === "win32" ? path.toLowerCase() : path;
      if ((seen.get(pathKey) ?? -1) >= remainingDepth) return;
      seen.set(pathKey, remainingDepth);
      if (seen.size > 10_000)
        return yield* Effect.fail(failure("Discovery directory limit exceeded: 10000"));
      yield* Effect.gen(function* () {
        yield* inspectDiscoveryPath(self.fileSystem, path, DiscoveryEntryKind.Directory);
        if ((input.scope.maxDepth === 0 || depth > 0) && !emitted.has(pathKey)) {
          const fingerprint = yield* directoryEvidence(self.fileSystem, path);
          output.candidates.push({
            key: `filesystem:${discoveryDigest(pathKey)}`,
            title: basename(path) || path,
            location: absoluteFilesystemLocation(path),
            externalRefs: [],
            evidence: [{ kind: "filesystem.directory", path, fingerprint }]
          });
          emitted.add(pathKey);
        }
        if (depth < input.scope.maxDepth) {
          const entries = yield* self.fileSystem.list(path, 4096);
          yield* Effect.forEach(entries, (entry) => {
            if (entry.kind === DiscoveryEntryKind.Link) {
              output.diagnostics.push({
                code: "link-skipped",
                message: "Linked entries are not scanned",
                path: join(path, entry.name)
              });
              return Effect.void;
            }
            if (entry.kind !== DiscoveryEntryKind.Directory) return Effect.void;
            return self.scan(root, join(path, entry.name), depth + 1, input, output, seen, emitted);
          });
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            output.diagnostics.push({
              code: "directory-unavailable",
              message: String(error),
              path
            });
          })
        )
      );
    });
  }
}

