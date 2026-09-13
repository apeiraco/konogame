import { createHash } from "node:crypto";
import { join } from "node:path";
import { ID_SERVICE, type IdService } from "@konogame/infrastructure";
import { type LocationPort } from "@konogame/infrastructure/contracts";
import {
  assertConfigurationRecord,
  ConfigurationInputKind,
  ConfigurationLayoutProblem,
  type ConfigurationRecord,
  type EditConfigurationInput,
  type ImportConfigurationInput,
  type InitializeConfigurationInput,
  materializeRecord,
  RecordKind,
  type RecoverEditConfigurationInput,
  type RecoverImportConfigurationInput,
  type RecoverInitializeConfigurationInput,
  type RenameConfigurationInput,
  recordFileKey,
  validateRelationships,
  type WorkspaceConfigurationPort,
  type WorkspaceSnapshot
} from "@konogame/workspace";
import { Effect } from "effect";
import {
  lstat,
  readdir,
  readFile,
  realpath,
  WORKSPACE_NODE_FILESYSTEM,
  type WorkspaceNodeFileSystem
} from "../filesystem/node.ts";
import { WORKSPACE_IMPORT_FILESYSTEM } from "../filesystem/tokens.ts";
import { assertConfigurationRecordSize, CONFIGURATION_RECORD_BYTE_LIMIT } from "../toml/limits.ts";
import { parseConfigurationToml } from "../toml/parser.ts";
import {
  ConfigurationInvalidInputError,
  configurationRule,
  decodeConfigurationText
} from "./errors.ts";
import { WorkspaceConfigurationImporter, type WorkspaceImportFileSystem } from "./import.ts";
import { WorkspaceConfigurationManager, type WorkspaceManagementFileSystem } from "./management.ts";
import { renameConfiguration } from "./rename.ts";

export { parseConfigurationToml } from "../toml/parser.ts";

const readRule = <Args extends unknown[], A>(evaluate: (...args: Args) => A, ...args: Args) =>
  configurationRule("read", evaluate, ...args);

export interface ConfigurationDocument {
  path: string;
  content: string;
  record: ConfigurationRecord;
  container?: string;
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const revisionOf = (documents: ConfigurationDocument[]) =>
  `sha256:${digest(JSON.stringify(documents.map(({ path, content }) => [path, content]).sort(([a], [b]) => a!.localeCompare(b!))))}`;
export const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
export function exists(path: string) {
  return lstat(path).pipe(
    Effect.as(true),
    Effect.catch((error) => (missing(error) ? Effect.succeed(false) : Effect.fail(error)))
  );
}
export function directory(path: string, optional = false) {
  return Effect.gen(function* () {
    const info = yield* lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) {
      return yield* Effect.fail(
        ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.Layout,
            path: path,
            problem: info.isSymbolicLink()
              ? ConfigurationLayoutProblem.Link
              : ConfigurationLayoutProblem.NotDirectory
          },
          `Expected configuration directory: ${path}`
        )
      );
    }
    return true;
  }).pipe(
    Effect.catch((error) =>
      optional && missing(error) ? Effect.succeed(false) : Effect.fail(error)
    )
  );
}
const filenamePattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(.+)$/u;

export function loadConfigurationState(
  inputRoot: string,
  options: { pendingHostContainer?: string; pendingHostContent?: string } = {}
) {
  return Effect.gen(function* () {
    const root = join(yield* realpath(inputRoot), ".konogame");
    yield* directory(root);
    const documents: ConfigurationDocument[] = [];
    const diagnostics: NonNullable<WorkspaceSnapshot["diagnostics"]> = [];
    const load = (
      path: string,
      kind: ConfigurationRecord["kind"],
      key?: string,
      container?: string
    ) =>
      Effect.gen(function* () {
        const info = yield* lstat(join(root, path));
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
              `Invalid configuration file: ${path}`
            )
          );
        }
        if (info.size > CONFIGURATION_RECORD_BYTE_LIMIT) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.RecordSize,
                limit: CONFIGURATION_RECORD_BYTE_LIMIT,
                actual: info.size
              },
              `Invalid configuration file: ${path}; record exceeds byte limit`
            )
          );
        }
        const content = yield* readRule(decodeConfigurationText, yield* readFile(join(root, path)));
        yield* readRule(assertConfigurationRecordSize, content);
        const record = yield* readRule(() =>
          assertConfigurationRecord(materializeRecord(parseConfigurationToml(content).data))
        );
        if (record.kind !== kind) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.Layout,
                path: path,
                problem: ConfigurationLayoutProblem.RecordKindMismatch,
                expected: kind,
                actual: record.kind
              },
              `Record kind/filename mismatch: ${path}`
            )
          );
        }
        if (key && record.id !== filenamePattern.exec(key)?.[1]) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.Layout,
                path,
                problem: ConfigurationLayoutProblem.RecordIdentityMismatch,
                expected: filenamePattern.exec(key)?.[1],
                actual: record.id
              },
              `Record kind/filename mismatch: ${path}`
            )
          );
        }
        if (key && record.kind !== RecordKind.Workspace) {
          const flat = path.endsWith(`${key}.toml`);
          const expected = yield* readRule(
            recordFileKey,
            record.id,
            record.uniformName,
            flat ? ".toml" : ""
          );
          if ((flat ? expected.slice(0, -5) : expected) !== key) {
            diagnostics.push({
              path,
              message: `Filename suffix differs from uniformName; expected ${expected}`
            });
          }
        }
        documents.push({ path, content, record, container });
        return record;
      });
    const scan = (parent: string, kind: ConfigurationRecord["kind"]) =>
      Effect.gen(function* () {
        if (!(yield* directory(join(root, parent), true))) {
          return [];
        }
        const records: { record: ConfigurationRecord; key: string; container: string }[] = [];
        const companions: string[] = [];
        const names = (yield* readdir(join(root, parent))).sort();
        const listed = yield* Effect.forEach(
          names,
          (name) => lstat(join(root, parent, name)).pipe(Effect.map((info) => ({ name, info }))),
          { concurrency: "unbounded" }
        );
        for (const { name, info } of listed) {
          if (info.isSymbolicLink()) {
            return yield* Effect.fail(
              ConfigurationInvalidInputError.make(
                {
                  kind: ConfigurationInputKind.Layout,
                  path: `${parent}/${name}`,
                  problem: ConfigurationLayoutProblem.Link
                },
                `Configuration links are forbidden: ${parent}/${name}`
              )
            );
          }
          if (name.endsWith(".json")) {
            return yield* Effect.fail(
              ConfigurationInvalidInputError.make(
                {
                  kind: ConfigurationInputKind.Layout,
                  path: `${parent}/${name}`,
                  problem: ConfigurationLayoutProblem.LegacyFormat
                },
                `Incompatible legacy configuration record: ${parent}/${name}`
              )
            );
          }
          const key = info.isFile() && name.endsWith(".toml") ? name.slice(0, -5) : name;
          if (!filenamePattern.test(key)) {
            if (name.endsWith(".toml")) {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  {
                    kind: ConfigurationInputKind.Layout,
                    path: `${parent}/${name}`,
                    problem: ConfigurationLayoutProblem.InvalidFilename
                  },
                  `Invalid record filename: ${parent}/${name}`
                )
              );
            }
            continue;
          }
          const container = `${parent}/${key}`;
          if (info.isFile() && name.endsWith(".toml")) {
            records.push({
              record: yield* load(`${parent}/${name}`, kind, key, container),
              key,
              container
            });
          } else if (info.isDirectory()) {
            const path = `${container}/${kind}.toml`;
            if (yield* exists(join(root, path))) {
              records.push({ record: yield* load(path, kind, key, container), key, container });
            } else if (kind === RecordKind.Host) {
              if (container === options.pendingHostContainer) {
                const children = yield* readdir(join(root, container));
                const approved = yield* Effect.forEach(
                  children,
                  (child) =>
                    Effect.gen(function* () {
                      if (
                        !/^host\.toml\.pending-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
                          child
                        ) ||
                        options.pendingHostContent === undefined
                      ) {
                        return false;
                      }
                      const childPath = join(root, container, child);
                      const staged = yield* lstat(childPath);
                      return (
                        staged.isFile() &&
                        !staged.isSymbolicLink() &&
                        staged.size <= CONFIGURATION_RECORD_BYTE_LIMIT &&
                        (yield* readRule(decodeConfigurationText, yield* readFile(childPath))) ===
                          options.pendingHostContent
                      );
                    }),
                  { concurrency: "unbounded" }
                );
                if (approved.every(Boolean)) {
                  continue;
                }
              }
              companions.push(key);
            } else {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  {
                    kind: ConfigurationInputKind.Layout,
                    path: `${container}/${kind}.toml`,
                    problem: ConfigurationLayoutProblem.NotFile
                  },
                  `Missing ${kind}.toml: ${container}`
                )
              );
            }
          }
        }
        const companionIds = new Set<string>();
        for (const key of companions) {
          const id = filenamePattern.exec(key)![1]!;
          if (companionIds.has(id)) {
            return yield* Effect.fail(
              ConfigurationInvalidInputError.make(
                {
                  kind: ConfigurationInputKind.Layout,
                  path: `${parent}/${key}`,
                  problem: ConfigurationLayoutProblem.DuplicateLayout
                },
                `Ambiguous Host companion containers: ${id}`
              )
            );
          }
          companionIds.add(id);
          const entry = records.find((record) => record.record.id === id);
          if (!entry) {
            return yield* Effect.fail(
              ConfigurationInvalidInputError.make(
                {
                  kind: ConfigurationInputKind.Layout,
                  path: `${parent}/${key}`,
                  problem: ConfigurationLayoutProblem.HostContainerMismatch
                },
                `Orphan Host container: ${parent}/${key}`
              )
            );
          }
          if (
            documents
              .find((document) => document.record === entry.record)
              ?.path.endsWith("/host.toml")
          ) {
            return yield* Effect.fail(
              ConfigurationInvalidInputError.make(
                {
                  kind: ConfigurationInputKind.Layout,
                  path: `${parent}/${key}`,
                  problem: ConfigurationLayoutProblem.DuplicateLayout
                },
                `Ambiguous Host companion containers: ${id}`
              )
            );
          }
          entry.container = `${parent}/${key}`;
          const document = documents.find((document) => document.record === entry.record)!;
          document.container = entry.container;
          if (entry.key !== key) {
            diagnostics.push({
              path: entry.container,
              message: "Host companion suffix differs from record filename; linked by UUID"
            });
          }
        }
        return records;
      });
    if (yield* exists(join(root, "workspace.json"))) {
      return yield* Effect.fail(
        ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.Layout,
            path: "workspace.json",
            problem: ConfigurationLayoutProblem.LegacyFormat
          },
          "Incompatible legacy workspace.json; workspace.toml is required"
        )
      );
    }
    const workspace = yield* load("workspace.toml", RecordKind.Workspace);
    if (workspace.kind !== RecordKind.Workspace) {
      return yield* Effect.fail(
        ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.Layout,
            path: "workspace.toml",
            problem: ConfigurationLayoutProblem.RecordKindMismatch,
            expected: RecordKind.Workspace,
            actual: workspace.kind
          },
          "Expected workspace"
        )
      );
    }
    const snapshot: WorkspaceSnapshot = {
      workspace,
      games: [],
      hosts: [],
      installations: [],
      revision: "",
      diagnostics
    };
    const [gameEntries, hostEntries] = yield* Effect.all(
      [scan("games", RecordKind.Game), scan("local", RecordKind.Host)],
      { concurrency: "unbounded" }
    );
    for (const entry of gameEntries) {
      if (entry.record.kind === RecordKind.Game) {
        snapshot.games.push(entry.record);
      }
    }
    for (const entry of hostEntries) {
      if (entry.record.kind !== RecordKind.Host) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.Layout,
              path: entry.container,
              problem: ConfigurationLayoutProblem.RecordKindMismatch,
              expected: RecordKind.Host,
              actual: entry.record.kind
            },
            "Expected Host"
          )
        );
      }
      snapshot.hosts.push(entry.record);
      for (const installation of yield* scan(
        `${entry.container}/installations`,
        RecordKind.Installation
      )) {
        if (installation.record.kind !== RecordKind.Installation) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.Layout,
                path: installation.container,
                problem: ConfigurationLayoutProblem.RecordKindMismatch,
                expected: RecordKind.Installation,
                actual: installation.record.kind
              },
              `Installation kind/path mismatch: ${installation.container}`
            )
          );
        }
        if (installation.record.hostId !== entry.record.id) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.Layout,
                path: installation.container,
                problem: ConfigurationLayoutProblem.HostContainerMismatch,
                expected: entry.record.id,
                actual: installation.record.hostId
              },
              `Installation host/path mismatch: ${installation.container}`
            )
          );
        }
        snapshot.installations.push(installation.record);
      }
    }
    snapshot.revision = revisionOf(documents);
    yield* readRule(validateRelationships, snapshot);
    return { root, snapshot, documents };
  });
}

export class TomlWorkspaceConfiguration implements WorkspaceConfigurationPort {
  private readonly importer: WorkspaceConfigurationImporter;
  private readonly manager: WorkspaceConfigurationManager;
  constructor(
    private readonly nodeFileSystem: WorkspaceNodeFileSystem,
    private readonly importFileSystem: WorkspaceImportFileSystem,
    managementFileSystem: WorkspaceManagementFileSystem,
    locationBehavior: LocationPort | undefined,
    private readonly ids: IdService
  ) {
    this.importer = new WorkspaceConfigurationImporter(importFileSystem, locationBehavior);
    this.manager = new WorkspaceConfigurationManager(managementFileSystem);
  }
  read(input: { root: string }): ReturnType<NonNullable<WorkspaceConfigurationPort["read"]>> {
    return loadConfigurationState(input.root).pipe(
      Effect.map((state) => state.snapshot),
      Effect.provideService(WORKSPACE_NODE_FILESYSTEM, this.nodeFileSystem)
    );
  }
  rename(
    input: RenameConfigurationInput
  ): ReturnType<NonNullable<WorkspaceConfigurationPort["rename"]>> {
    return renameConfiguration(input).pipe(
      Effect.provideService(WORKSPACE_NODE_FILESYSTEM, this.nodeFileSystem),
      Effect.provideService(ID_SERVICE, this.ids),
      Effect.provideService(WORKSPACE_IMPORT_FILESYSTEM, this.importFileSystem)
    );
  }
  import(
    input: ImportConfigurationInput
  ): ReturnType<NonNullable<WorkspaceConfigurationPort["import"]>> {
    return this.importer.import(input);
  }
  recoverImport(
    input: RecoverImportConfigurationInput
  ): ReturnType<NonNullable<WorkspaceConfigurationPort["recoverImport"]>> {
    return this.importer.recover(input);
  }
  initialize(
    input: InitializeConfigurationInput
  ): ReturnType<NonNullable<WorkspaceConfigurationPort["initialize"]>> {
    return this.manager.initialize(input);
  }
  recoverInitialize(
    input: RecoverInitializeConfigurationInput
  ): ReturnType<NonNullable<WorkspaceConfigurationPort["recoverInitialize"]>> {
    return this.manager.recoverInitialize(input);
  }
  edit(input: EditConfigurationInput): ReturnType<NonNullable<WorkspaceConfigurationPort["edit"]>> {
    return this.manager.edit(input);
  }
  recoverEdit(
    input: RecoverEditConfigurationInput
  ): ReturnType<NonNullable<WorkspaceConfigurationPort["recoverEdit"]>> {
    return this.manager.recoverEdit(input);
  }
}
