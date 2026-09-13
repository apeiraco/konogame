import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  absoluteFilesystemLocation,
  DiscoveryEntryKind,
  type DiscoveryFileSystem,
  directoryDiscoveryScopeSchema,
  directoryEvidence,
  discoveryDigest,
  GAME_DISCOVERY_FILESYSTEM,
  inspectDiscoveryPath
} from "@konogame/extension-filesystem";
import { gameDiscoveryImplementation } from "@konogame/game";
import {
  type DiscoveryEvidence,
  GameDiscoveryError,
  type GameDiscoveryInput,
  type GameDiscoveryPort,
  type GameDiscoveryResult,
  GameOperation,
  gameDiscoveryInputSchema
} from "@konogame/game/contracts";
import { type ExtensionActivationContext } from "@konogame/infrastructure";
import { ExternalIdentityPurpose } from "@konogame/workspace/contracts";
import { type } from "arktype";
import { Context, Effect } from "effect";
import { type KeyValuesObject, KeyValuesParser } from "./keyvalues.ts";
import {
  steamFilesystemDependencyId,
  steamGameDiscoveryAdapter,
  steamSourceKind
} from "./manifest.ts";
import { extensionMetadata } from "./metadata.ts";

export { KeyValuesParser } from "./keyvalues.ts";
export * from "./manifest.ts";
export * from "./providers.ts";

const keyValuesObject = type("object");
const keyValuesText = type.string
  .atLeastLength(1)
  .narrow((value, ctx) => value.trim().length > 0 || ctx.mustBe("a nonempty KeyValues string"));
const steamAppId = type.string
  .matching(/^[1-9][0-9]*$/)
  .narrow(
    (value, ctx) =>
      (Number.isSafeInteger(Number(value)) && Number(value) <= 0xffff_ffff) ||
      ctx.mustBe("a Steam App ID")
  );
function object(value: string | KeyValuesObject | undefined): KeyValuesObject {
  const parsed = keyValuesObject(value);
  if (parsed instanceof type.errors) {
    throw new Error("Expected a KeyValues object");
  }
  return parsed as KeyValuesObject;
}
function text(value: string | KeyValuesObject | undefined): string {
  const parsed = keyValuesText(value);
  if (parsed instanceof type.errors) {
    throw new Error("Expected a nonempty KeyValues string");
  }
  return parsed;
}
function appId(value: string): string {
  const parsed = steamAppId(value);
  if (parsed instanceof type.errors) {
    throw new Error("Invalid Steam App ID");
  }
  return parsed;
}
function pathIdentity(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
function excluded(path: string, root: string, prefixes: string[]): boolean {
  const suffix = relative(root, path).split(sep).join("/");
  return prefixes.some((prefix) => suffix === prefix || suffix.startsWith(`${prefix}/`));
}
const failure = (cause: unknown) =>
  new GameDiscoveryError({
    operation: GameOperation.Discover,
    cause,
    message: cause instanceof Error ? cause.message : String(cause)
  });
const parse = <A>(run: () => A) => Effect.try({ try: run, catch: failure });

export class SteamGameDiscovery implements GameDiscoveryPort {
  constructor(private readonly fileSystem: DiscoveryFileSystem) {}

  discover(input: GameDiscoveryInput): Effect.Effect<GameDiscoveryResult, GameDiscoveryError> {
    const self = this;
    return Effect.gen(function* () {
      const request = yield* parse(() => gameDiscoveryInputSchema.assert(input));
      if (request.sourceKind !== steamSourceKind) {
        return yield* Effect.fail(failure("Steam discovery requires a Steam source"));
      }
      const scope = yield* parse(() => directoryDiscoveryScopeSchema.assert(request.scope));
      const output: GameDiscoveryResult = { observations: [], diagnostics: [] };
      const libraries = [...new Set(scope.paths.map((path) => resolve(path)))].sort();
      if (libraries.length > 64) {
        return yield* Effect.fail(failure("Steam library limit exceeded: 64"));
      }
      const seen = new Set<string>();
      let observedManifests = 0;
      for (const selected of libraries) {
        const steamapps =
          basename(selected).toLowerCase() === "steamapps" ? selected : join(selected, "steamapps");
        if (excluded(steamapps, selected, scope.exclude)) {
          continue;
        }
        const exhausted = yield* Effect.gen(function* () {
          yield* inspectDiscoveryPath(self.fileSystem, steamapps, DiscoveryEntryKind.Directory);
          const entries = yield* self.fileSystem.list(steamapps, 10_000);
          const evidence: DiscoveryEvidence[] = [];
          if (entries.some((entry) => entry.name === "libraryfolders.vdf")) {
            const path = join(steamapps, "libraryfolders.vdf");
            yield* Effect.gen(function* () {
              const content = yield* self.readManifest(path);
              const references = yield* parse(() => {
                const folders = object(new KeyValuesParser(content).parse().libraryfolders);
                const references: string[] = [];
                for (const [index, value] of Object.entries(folders)) {
                  if (!/^\d+$/.test(index)) {
                    continue;
                  }
                  const asText = keyValuesText(value);
                  const referenced =
                    asText instanceof type.errors ? text(object(value).path) : asText;
                  if (!isAbsolute(referenced)) {
                    throw new Error("Steam library path is not absolute");
                  }
                  references.push(resolve(referenced));
                }
                return references;
              });
              evidence.push({
                kind: "steam.libraryfolders",
                path,
                fingerprint: discoveryDigest(content)
              });
              for (const normalized of references) {
                if (
                  !libraries.some(
                    (library) =>
                      pathIdentity(library) === pathIdentity(normalized) ||
                      pathIdentity(library) === pathIdentity(join(normalized, "steamapps"))
                  )
                ) {
                  output.diagnostics.push({
                    code: "library-outside-scope",
                    message:
                      "Referenced Steam library requires an explicit selected path; it was not scanned",
                    path: normalized
                  });
                }
              }
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  output.diagnostics.push({
                    code: "invalid-libraryfolders",
                    message: String(error),
                    path
                  });
                })
              )
            );
          }
          for (const entry of entries) {
            if (!/^appmanifest_.*\.acf$/i.test(entry.name)) {
              continue;
            }
            if (++observedManifests > 10_000) {
              output.diagnostics.push({
                code: "scan-limit",
                message: "Steam manifest visit limit exceeded: 10000",
                path: steamapps
              });
              return true;
            }
            const manifestPath = join(steamapps, entry.name);
            if (excluded(manifestPath, selected, scope.exclude)) {
              continue;
            }
            yield* Effect.gen(function* () {
              const expectedId = yield* parse(() => {
                if (entry.kind !== DiscoveryEntryKind.File) {
                  throw new Error("Manifest must be a regular file; links are forbidden");
                }
                const match = /^appmanifest_([1-9][0-9]*)\.acf$/.exec(entry.name);
                if (!match) {
                  throw new Error("Invalid Steam appmanifest filename");
                }
                return appId(match[1]!);
              });
              const content = yield* self.readManifest(manifestPath);
              const app = yield* parse(() => {
                const app = object(new KeyValuesParser(content).parse().AppState);
                const id = appId(text(app.appid));
                if (id !== expectedId) {
                  throw new Error("Steam App ID differs from manifest filename");
                }
                const state = text(app.StateFlags);
                if (
                  !/^\d+$/.test(state) ||
                  !Number.isSafeInteger(Number(state)) ||
                  Number(state) > 0xffff_ffff ||
                  (Number(state) & 4) === 0
                ) {
                  throw new Error("Steam installation is not marked fully installed");
                }
                const name = text(app.installdir);
                // Reject both Windows and POSIX traversal regardless of the parser host.
                if (name === "." || name === ".." || /[\\/:\0]/.test(name) || /[. ]$/.test(name)) {
                  throw new Error("Steam installdir must be one safe directory component");
                }
                return { id, name, title: text(app.name) };
              });
              const location = join(steamapps, "common", app.name);
              if (excluded(location, selected, scope.exclude)) {
                return;
              }
              const fingerprint = yield* directoryEvidence(self.fileSystem, location);
              const key = `steam:${app.id}:${discoveryDigest(pathIdentity(location))}`;
              if (seen.has(key)) {
                return;
              }
              seen.add(key);
              if (seen.size > 10_000) {
                return yield* Effect.fail(failure("Steam candidate limit exceeded: 10000"));
              }
              output.observations.push({
                observationKey: key,
                title: app.title,
                location: absoluteFilesystemLocation(location),
                externalIdentities: [
                  {
                    issuer: extensionMetadata.id,
                    purpose: ExternalIdentityPurpose.Game,
                    value: `app:${app.id}`
                  }
                ],
                externalRefs: [{ authority: "steam", kind: "app", key: { appId: app.id } }],
                evidence: [
                  ...evidence,
                  {
                    kind: "steam.appmanifest",
                    path: manifestPath,
                    fingerprint: discoveryDigest(content)
                  },
                  { kind: "filesystem.directory", path: location, fingerprint }
                ]
              });
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  output.diagnostics.push({
                    code: "invalid-appmanifest",
                    message: String(error),
                    path: manifestPath
                  });
                })
              )
            );
          }
          return false;
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              output.diagnostics.push({
                code: "library-unavailable",
                message: String(error),
                path: steamapps
              });
              return false;
            })
          )
        );
        if (exhausted) {
          break;
        }
      }
      return output;
    });
  }

  private readManifest(path: string) {
    const self = this;
    return Effect.gen(function* () {
      yield* inspectDiscoveryPath(self.fileSystem, path, DiscoveryEntryKind.File);
      return yield* self.fileSystem.readText(path, 1024 * 1024);
    });
  }
}

export function activate(context: ExtensionActivationContext) {
  return Effect.gen(function* () {
    const dependencies = yield* context.dependencyServices(steamFilesystemDependencyId);
    const fileSystem = Context.get(dependencies, GAME_DISCOVERY_FILESYSTEM);
    yield* context.registerAdapter(
      steamGameDiscoveryAdapter.id,
      gameDiscoveryImplementation,
      new SteamGameDiscovery(fileSystem)
    );
  });
}
