import { basename, join, relative, resolve, sep } from "node:path";
import {
  GameDiscoveryError,
  type GameDiscoveryInput,
  type GameDiscoveryPort,
  type GameDiscoveryResult,
  GameOperation,
  gameDiscoveryInputSchema
} from "@konogame/game/contracts";
import { ExternalIdentityPurpose } from "@konogame/workspace/contracts";
import { Effect } from "effect";
import { absoluteFilesystemLocation } from "../location/values.ts";
import { filesystemSourceKind } from "../manifest.ts";
import { extensionMetadata } from "../metadata.ts";
import { directoryEvidence, discoveryDigest, inspectDiscoveryPath } from "./evidence.ts";
import { DiscoveryEntryKind, type DiscoveryFileSystem } from "./filesystem.ts";
import { type DirectoryDiscoveryScope, directoryDiscoveryScopeSchema } from "./scope.ts";

export { filesystemGameDiscoveryAdapter } from "../manifest.ts";

const failure = (cause: unknown) =>
  new GameDiscoveryError({
    operation: GameOperation.Discover,
    cause,
    message: cause instanceof Error ? cause.message : String(cause)
  });

export class FilesystemGameDiscovery implements GameDiscoveryPort {
  constructor(private readonly fileSystem: DiscoveryFileSystem) {}

  discover(input: GameDiscoveryInput): Effect.Effect<GameDiscoveryResult, GameDiscoveryError> {
    const self = this;
    return Effect.gen(function* () {
      const scope = yield* Effect.try({
        try: () => {
          gameDiscoveryInputSchema.assert(input);
          if (input.sourceKind !== filesystemSourceKind)
            throw new Error("Filesystem discovery requires a standalone source");
          return directoryDiscoveryScopeSchema.assert(input.scope);
        },
        catch: failure
      });
      const output: GameDiscoveryResult = { observations: [], diagnostics: [] };
      const seen = new Map<string, number>();
      const emitted = new Set<string>();
      yield* Effect.forEach([...new Set(scope.paths.map((path) => resolve(path)))].sort(), (path) =>
        self.scan(path, path, 0, scope, output, seen, emitted, input.hostId)
      );
      return output;
    });
  }

  private scan(
    root: string,
    path: string,
    depth: number,
    scope: DirectoryDiscoveryScope,
    output: GameDiscoveryResult,
    seen: Map<string, number>,
    emitted: Set<string>,
    hostId: string
  ): Effect.Effect<void, GameDiscoveryError> {
    const self = this;
    return Effect.gen(function* () {
      const suffix = relative(root, path).split(sep).join("/");
      if (
        scope.exclude.some(
          (value) =>
            suffix === value.replaceAll("\\", "/") ||
            suffix.startsWith(`${value.replaceAll("\\", "/")}/`)
        )
      )
        return;
      const remainingDepth = scope.maxDepth - depth;
      const pathKey = process.platform === "win32" ? path.toLowerCase() : path;
      if ((seen.get(pathKey) ?? -1) >= remainingDepth) return;
      seen.set(pathKey, remainingDepth);
      if (seen.size > 10_000)
        return yield* Effect.fail(failure("Discovery directory limit exceeded: 10000"));
      yield* Effect.gen(function* () {
        const info = yield* inspectDiscoveryPath(
          self.fileSystem,
          path,
          DiscoveryEntryKind.Directory
        );
        if ((scope.maxDepth === 0 || depth > 0) && !emitted.has(pathKey)) {
          const fingerprint = yield* directoryEvidence(self.fileSystem, path);
          if ((yield* self.fileSystem.inspect(path)).identity !== info.identity)
            return yield* Effect.fail(failure("Discovery directory changed before publication"));
          const object = info.fileObject;
          const reliableObject =
            object &&
            [object.volumeId, object.objectId].every((value) => /^[1-9][0-9]*$/.test(value));
          output.observations.push({
            observationKey: `filesystem:${discoveryDigest(pathKey)}`,
            title: basename(path) || path,
            location: absoluteFilesystemLocation(path),
            externalRefs: [],
            ...(reliableObject
              ? {
                  externalIdentities: [
                    {
                      issuer: extensionMetadata.id,
                      purpose: ExternalIdentityPurpose.Installation,
                      value: JSON.stringify([
                        hostId,
                        object.volumeId,
                        object.objectId,
                        object.birthTime ?? ""
                      ])
                    }
                  ]
                }
              : {}),
            evidence: [{ kind: "filesystem.directory", path, fingerprint }]
          });
          emitted.add(pathKey);
        }
        if (depth < scope.maxDepth) {
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
            return self.scan(
              root,
              join(path, entry.name),
              depth + 1,
              scope,
              output,
              seen,
              emitted,
              hostId
            );
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
