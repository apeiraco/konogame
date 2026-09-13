import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type Contribution,
  type DiscoveryBatch,
  type ExtensionDiscoverySource,
  type LifecycleDiagnostic,
  LifecyclePhase,
  observeNativePromise,
  ReloadPolicy
} from "@konogame/infrastructure";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { InstalledExtensionError, type InstalledExtensionFileSystem } from "./filesystem.ts";
import {
  EXTENSION_PACKAGE_COUNT_LIMIT,
  EXTENSION_PACKAGE_FILENAME,
  type ExtensionPackage,
  parseExtensionPackage,
  validateExtensionRoots
} from "./package.ts";

// Node caches ESM for the process lifetime, including dependencies and failed imports.
const attemptedEntries = new Map<string, string>();
interface Observation {
  package: ExtensionPackage;
  configuredRoot: string;
  candidate: string;
  root: string;
  directory: string;
  manifestPath: string;
  entryPath: string;
  entryHash: string;
  revision: string;
}
export interface NodeInstalledExtensionOptions {
  roots: readonly string[];
  id?: string;
}
function inside(root: string, path: string): boolean {
  const delta = relative(root, path);
  return delta === "" || (!isAbsolute(delta) && delta !== ".." && !delta.startsWith(`..${sep}`));
}
function hash(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
const parse = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => InstalledExtensionError.from(operation, cause)
  });

export class NodeInstalledExtensionSource implements ExtensionDiscoverySource {
  readonly id: string;
  private readonly roots: readonly string[];
  private readonly knownIds = new Map<string, string>();
  constructor(
    options: NodeInstalledExtensionOptions,
    private readonly fileSystem: InstalledExtensionFileSystem
  ) {
    this.id = options.id ?? "node.installed-extensions";
    if (!this.id.trim()) {
      throw new Error("Discovery source ID must not be empty");
    }
    this.roots = validateExtensionRoots(options.roots);
  }

  discover(): Effect.Effect<DiscoveryBatch, InstalledExtensionError> {
    const self = this;
    return Effect.gen(function* () {
      const diagnostics: LifecycleDiagnostic[] = [];
      const candidates: Observation[] = [];
      const restartRequired: string[] = [];
      const report = (reason: string, contributionId?: string) => {
        diagnostics.push({
          sourceId: self.id,
          phase: LifecyclePhase.Discovery,
          reason,
          ...(contributionId ? { contributionId } : {})
        });
      };
      let count = 0;
      for (const configuredRoot of self.roots) {
        yield* Effect.gen(function* () {
          const root = yield* self.fileSystem.realPath(configuredRoot);
          const directories = yield* self.fileSystem.directories(root);
          if (count + directories.length > EXTENSION_PACKAGE_COUNT_LIMIT) {
            return yield* Effect.fail(
              InstalledExtensionError.from(
                "discover",
                `Installed extension package limit is ${EXTENSION_PACKAGE_COUNT_LIMIT}`
              )
            );
          }
          count += directories.length;
          const observed = yield* Effect.forEach(
            directories,
            (name) => {
              const directory = join(root, name);
              return self.observe(configuredRoot, directory).pipe(
                Effect.map((value) => ({ directory, value, error: undefined })),
                Effect.catch((error) => Effect.succeed({ directory, value: undefined, error }))
              );
            },
            { concurrency: "unbounded" }
          );
          for (const item of observed) {
            if (item.error) {
              report(`${item.directory}: ${String(item.error)}`, self.knownIds.get(item.directory));
              continue;
            }
            const value = item.value!;
            self.knownIds.set(item.directory, value.package.manifest.id);
            const attempted = attemptedEntries.get(value.entryPath);
            if (attempted !== undefined && attempted !== value.entryHash) {
              restartRequired.push(value.package.manifest.id);
              report(
                `restart-service-required: loaded ESM entry changed: ${value.entryPath}`,
                value.package.manifest.id
              );
            } else {
              candidates.push(value);
            }
          }
        }).pipe(
          Effect.catch((error) =>
            Effect.sync(() => {
              report(`${configuredRoot}: ${String(error)}`);
            })
          )
        );
      }
      const grouped = new Map<string, Observation[]>();
      for (const observed of candidates) {
        const id = observed.package.manifest.id;
        const group = grouped.get(id) ?? [];
        group.push(observed);
        grouped.set(id, group);
      }
      const contributions: Contribution[] = [];
      for (const [id, group] of grouped) {
        if (group.length !== 1) {
          report(
            `Duplicate installed Extension ID ${id}: ${group.map((item) => item.directory).join(", ")}`,
            id
          );
          continue;
        }
        const observed = group[0]!;
        contributions.push({
          kind: AdapterOwnerKind.Extension,
          manifest: observed.package.manifest,
          revision: observed.revision,
          reloadPolicy: ReloadPolicy.RestartAfterLoad,
          load: () => self.load(observed)
        });
      }
      return {
        complete: diagnostics.length === 0,
        contributions,
        diagnostics,
        restartRequired
      };
    });
  }

  private observe(
    configuredRoot: string,
    candidate: string
  ): Effect.Effect<Observation, InstalledExtensionError> {
    const self = this;
    return Effect.gen(function* () {
      const [root, directory] = yield* Effect.all(
        [self.fileSystem.realPath(configuredRoot), self.fileSystem.realPath(candidate)],
        { concurrency: "unbounded" }
      );
      if (!inside(root, directory)) {
        return yield* Effect.fail(
          InstalledExtensionError.from("observe", "Package realpath escapes installed root")
        );
      }
      const manifestPath = yield* self.fileSystem.realPath(
        join(directory, EXTENSION_PACKAGE_FILENAME)
      );
      if (!inside(directory, manifestPath)) {
        return yield* Effect.fail(
          InstalledExtensionError.from("observe", "Manifest realpath escapes package")
        );
      }
      const bytes = yield* self.fileSystem.manifest(manifestPath);
      const declared = yield* parse("parse-package", () =>
        parseExtensionPackage(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
      );
      const entryPath = yield* self.fileSystem.realPath(resolve(directory, declared.module.entry));
      if (!inside(root, entryPath) || !inside(directory, entryPath)) {
        return yield* Effect.fail(
          InstalledExtensionError.from(
            "observe",
            "Entry realpath escapes package or installed root"
          )
        );
      }
      const entryHash = yield* self.fileSystem.entryHash(entryPath);
      return {
        package: declared,
        configuredRoot,
        candidate,
        root,
        directory,
        manifestPath,
        entryPath,
        entryHash,
        revision: hash(
          JSON.stringify([hash(bytes), entryHash, root, directory, manifestPath, entryPath])
        )
      };
    });
  }

  private load(observed: Observation): Effect.Effect<unknown, InstalledExtensionError> {
    const self = this;
    return Effect.gen(function* () {
      const current = yield* self.observe(observed.configuredRoot, observed.candidate);
      if (current.revision !== observed.revision) {
        return yield* Effect.fail(
          InstalledExtensionError.from(
            "load",
            "Installed Extension changed after discovery; refresh is required"
          )
        );
      }
      const attempted = attemptedEntries.get(current.entryPath);
      if (attempted !== undefined && attempted !== current.entryHash) {
        return yield* Effect.fail(
          InstalledExtensionError.from(
            "load",
            "restart-service-required: ESM entry has already been attempted with different code"
          )
        );
      }
      attemptedEntries.set(current.entryPath, current.entryHash);
      const namespace = yield* Effect.tryPromise({
        try: () => import(pathToFileURL(current.entryPath).href),
        catch: (cause) => InstalledExtensionError.from("import-entry", cause)
      });
      const value = yield* parse("create-module", () => {
        const factory: unknown = Reflect.get(namespace, current.package.module.factory);
        if (typeof factory !== "function") {
          throw new Error(
            `Extension factory export is not callable: ${current.package.module.factory}`
          );
        }
        const created: unknown = factory(current.package.module.options);
        if (observeNativePromise(created)) {
          throw new Error("Extension factory must return an ExtensionModule or an Effect");
        }
        return created;
      });
      // Installed factories are a dynamic boundary; their services belong in the returned module Layer.
      return Effect.isEffect(value)
        ? yield* (value as Effect.Effect<unknown, unknown>).pipe(
            Effect.mapError((cause) => InstalledExtensionError.from("create-module", cause))
          )
        : value;
    });
  }
}
