import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { assertSchema, type LocationPort } from "@konogame/infrastructure/contracts";
import {
  assertConfigurationRecord,
  ConfigurationInputKind,
  ConfigurationJournalProblem,
  ConfigurationPathProblem,
  type ConfigurationRecord,
  type ImportConfigurationInput,
  type ImportConfigurationResult,
  ImportStatus,
  importConfigurationInputSchema,
  RecordKind,
  type RecoverImportConfigurationInput,
  recordFileKey,
  uuidSchema,
  validateRelationships,
  type WorkspaceConfigurationError
} from "@konogame/workspace";
import { Effect, Exit } from "effect";
import {
  accept,
  type ImportJournal,
  importJournalSchema,
  operationReceiptSchema
} from "../coordination/journals.ts";
import {
  WorkspaceWriterConflict as Conflict,
  catchConfigurationResult,
  WorkspaceWriterRecoveryRequired as RecoveryRequired,
  withWorkspaceWriterLock
} from "../coordination/writer-lock.ts";
import { type WorkspaceFileSystemError } from "../filesystem/node.ts";
import { assertConfigurationRecordSize, CONFIGURATION_RECORD_BYTE_LIMIT } from "../toml/limits.ts";
import { parseConfigurationToml } from "../toml/parser.ts";
import { digest, type loadConfigurationState } from "./configuration.ts";
import {
  ConfigurationInvalidInputError,
  configurationRule,
  parseConfigurationJson
} from "./errors.ts";

export const ImportPathKind = {
  File: "file",
  Directory: "directory",
  Other: "other"
} as const;
export type ImportPathKind = (typeof ImportPathKind)[keyof typeof ImportPathKind];
export type WorkspaceImportState = Effect.Success<ReturnType<typeof loadConfigurationState>>;
export interface WorkspaceImportFileSystem {
  readonly processId: number;
  canonicalRoot(path: string): Effect.Effect<string, WorkspaceConfigurationError>;
  inspect(path: string): Effect.Effect<ImportPathKind | undefined, WorkspaceFileSystemError>;
  read(path: string, maxBytes: number): Effect.Effect<string, WorkspaceConfigurationError>;
  create(path: string, content: string): Effect.Effect<void, WorkspaceFileSystemError>;
  mkdir(path: string): Effect.Effect<void, WorkspaceFileSystemError>;
  remove(path: string): Effect.Effect<void, WorkspaceFileSystemError>;
  processAlive(pid: number): Effect.Effect<boolean, WorkspaceFileSystemError>;
  readWorkspace(root: string): Effect.Effect<WorkspaceImportState, WorkspaceConfigurationError>;
}

type ImportEntry = ImportJournal["entries"][number];

function tomlValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value).replace(
      /[\u007f-\u009f]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${tomlValue(key)} = ${tomlValue(item)}`)
      .join(", ")} }`;
  }
  throw ConfigurationInvalidInputError.make(
    { kind: ConfigurationInputKind.Value, format: "toml", valueType: typeof value },
    "Unsupported TOML import value"
  );
}
export function serializeNewConfiguration(record: ConfigurationRecord): string {
  const content = `${Object.entries(assertConfigurationRecord(record))
    .map(([key, value]) => `${tomlValue(key)} = ${tomlValue(value)}`)
    .join("\n")}\n`;
  assertConfigurationRecordSize(content);
  assertConfigurationRecord(parseConfigurationToml(content).data);
  return content;
}

export class WorkspaceConfigurationImporter {
  constructor(
    private readonly fileSystem: WorkspaceImportFileSystem,
    private readonly locationBehavior?: LocationPort
  ) {}

  recover(input: RecoverImportConfigurationInput) {
    return Effect.gen({ self: this }, function* () {
      return yield* Effect.gen({ self: this }, function* () {
        yield* configurationRule(
          "recover",
          (value: unknown) => assertSchema("configuration.uuidSchema", uuidSchema, value),
          input.operationId
        );
        const root = join(yield* this.fileSystem.canonicalRoot(input.root), ".konogame");
        if ((yield* this.fileSystem.inspect(root)) !== ImportPathKind.Directory) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              { kind: ConfigurationInputKind.Root, path: input.root },
              "Invalid Workspace configuration root"
            )
          );
        }
        yield* this.checkParents(root, "recovery/import/journal.json");
        const journalPath = join(root, "recovery/import/journal.json");
        if (!(yield* this.fileSystem.inspect(journalPath))) {
          const receiptPath = join(root, `recovery/import/${input.operationId}.json`);
          if (yield* this.fileSystem.inspect(receiptPath)) {
            const receipt = accept(
              operationReceiptSchema,
              yield* configurationRule(
                "recover",
                parseConfigurationJson,
                yield* this.fileSystem.read(receiptPath, 4096)
              )
            );
            if (!receipt) {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  {
                    kind: ConfigurationInputKind.Receipt,
                    workflow: "import",
                    operationId: input.operationId
                  },
                  "Invalid import receipt"
                )
              );
            }
            return {
              status: ImportStatus.Unchanged,
              operationId: input.operationId,
              revision: (yield* this.fileSystem.readWorkspace(input.root)).snapshot.revision
            };
          }
          return {
            status: ImportStatus.Failed,
            operationId: input.operationId,
            reason: "No pending import or completed receipt exists for this operation"
          };
        }
        const journal = yield* configurationRule(
          "recover",
          this.parseJournal.bind(this),
          yield* this.fileSystem.read(journalPath, 32 * 1024 * 1024)
        );
        if (journal.operationId !== input.operationId) {
          return {
            status: ImportStatus.RecoveryRequired,
            operationId: input.operationId,
            reason: "Another import requires recovery"
          };
        }
        const records = journal.entries.map((entry) =>
          assertConfigurationRecord(parseConfigurationToml(entry.content).data)
        );
        return yield* this.executeImport(
          {
            ...input,
            root: dirname(root),
            expectedRevision: journal.expectedRevision,
            games: records.filter((record) => record.kind === RecordKind.Game),
            installations: records.filter((record) => record.kind === RecordKind.Installation)
          },
          true
        );
      }).pipe(
        catchConfigurationResult((error) =>
          Effect.succeed({
            status: ImportStatus.RecoveryRequired,
            operationId: input.operationId,
            reason: String(error)
          })
        )
      );
    });
  }

  import(raw: ImportConfigurationInput) {
    return Effect.gen({ self: this }, function* () {
      return yield* this.executeImport(raw, false);
    });
  }

  private executeImport(raw: ImportConfigurationInput, recoveryOnly: boolean) {
    return Effect.gen({ self: this }, function* () {
      const checked = yield* Effect.exit(
        (() =>
          Effect.gen({ self: this }, function* () {
            let input = yield* configurationRule(
              "executeImport",
              (value: unknown) =>
                assertSchema(
                  "configuration.importConfigurationInputSchema",
                  importConfigurationInputSchema,
                  value
                ),
              raw
            );
            if (input.games.length + input.installations.length > 10_000) {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  {
                    kind: ConfigurationInputKind.Limit,
                    subject: "import-records",
                    limit: 10_000,
                    actual: input.games.length + input.installations.length
                  },
                  "Import record limit exceeded"
                )
              );
            }
            const root = join(yield* this.fileSystem.canonicalRoot(input.root), ".konogame");
            input = { ...input, root: dirname(root) };
            if ((yield* this.fileSystem.inspect(root)) !== ImportPathKind.Directory) {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  { kind: ConfigurationInputKind.Root, path: input.root },
                  "Invalid Workspace configuration root"
                )
              );
            }
            for (const path of ["recovery", "recovery/rename", "recovery/import"]) {
              yield* this.ensureDirectory(root, path);
            }

            return { input, root };
          }))()
      );
      if (Exit.isFailure(checked)) {
        return yield* Effect.failCause(checked.cause).pipe(
          catchConfigurationResult((error) =>
            Effect.succeed({
              status: ImportStatus.Failed,
              operationId: raw.operationId,
              reason: String(error)
            })
          )
        );
      }
      const { input, root } = checked.value;
      const output = (
        status: ImportStatus,
        reason?: string,
        revision?: string
      ): ImportConfigurationResult => ({
        status,
        operationId: input.operationId,
        gameIds: input.games.map((game) => game.id),
        installationIds: input.installations.map((installation) => installation.id),
        ...(reason ? { reason } : {}),
        ...(revision ? { revision } : {})
      });
      const journalPath = join(root, "recovery/import/journal.json");
      const receiptPath = join(root, `recovery/import/${input.operationId}.json`);
      const requestHash = digest(
        JSON.stringify({
          expectedRevision: input.expectedRevision,
          games: input.games,
          installations: input.installations
        })
      );
      return yield* Effect.gen({ self: this }, function* () {
        return yield* withWorkspaceWriterLock(
          this.fileSystem,
          root,
          input.operationId,
          "import",
          () =>
            Effect.gen({ self: this }, function* () {
              if (yield* this.fileSystem.inspect(receiptPath)) {
                const receipt = accept(
                  operationReceiptSchema,
                  yield* configurationRule(
                    "executeImport",
                    parseConfigurationJson,
                    yield* this.fileSystem.read(receiptPath, 4096)
                  )
                );
                if (!receipt) {
                  return output(ImportStatus.Failed, "Invalid import receipt");
                }
                if (receipt.requestHash !== requestHash) {
                  return output(
                    ImportStatus.Conflict,
                    "Operation ID was already used for a different import"
                  );
                }
                if (yield* this.fileSystem.inspect(journalPath)) {
                  const pending = yield* configurationRule(
                    "executeImport",
                    this.parseJournal.bind(this),
                    yield* this.fileSystem.read(journalPath, 32 * 1024 * 1024)
                  );
                  if (pending.operationId !== input.operationId) {
                    return output(
                      ImportStatus.RecoveryRequired,
                      "Another import requires recovery"
                    );
                  }
                  yield* this.fileSystem.remove(journalPath);
                }
                return output(
                  ImportStatus.Unchanged,
                  undefined,
                  (yield* this.fileSystem.readWorkspace(input.root)).snapshot.revision
                );
              }
              let journal: ImportJournal;
              if (yield* this.fileSystem.inspect(journalPath)) {
                journal = yield* configurationRule(
                  "executeImport",
                  this.parseJournal.bind(this),
                  yield* this.fileSystem.read(journalPath, 32 * 1024 * 1024)
                );
                if (
                  journal.operationId !== input.operationId ||
                  journal.requestHash !== requestHash
                ) {
                  return output(
                    ImportStatus.RecoveryRequired,
                    "Another import requires recovery; retry its original request"
                  );
                }
              } else {
                if (recoveryOnly) {
                  return output(
                    ImportStatus.Failed,
                    "Pending import disappeared before recovery; no new operation was started"
                  );
                }
                const state = yield* this.fileSystem.readWorkspace(input.root);
                if (state.snapshot.revision !== input.expectedRevision) {
                  return output(
                    ImportStatus.Conflict,
                    "Workspace revision changed",
                    state.snapshot.revision
                  );
                }
                const ids = new Set(state.documents.map((document) => document.record.id));
                for (const record of [...input.games, ...input.installations]) {
                  if (ids.has(record.id)) {
                    return output(ImportStatus.Conflict, `Record ID already exists: ${record.id}`);
                  }
                  ids.add(record.id);
                }
                yield* configurationRule("executeImport", validateRelationships, {
                  ...state.snapshot,
                  games: [...state.snapshot.games, ...input.games],
                  installations: [...state.snapshot.installations, ...input.installations]
                });
                const installations = [...state.snapshot.installations];
                for (const installation of input.installations) {
                  if (!this.locationBehavior?.validate || !this.locationBehavior.compare) {
                    return output(
                      ImportStatus.Failed,
                      "Location behavior is unavailable for admission"
                    );
                  }
                  const host = state.snapshot.hosts.find(
                    (entry) => entry.id === installation.hostId
                  )!;
                  const context = {
                    platform: host.platform,
                    roots: host.roots
                  };
                  const validation = yield* this.locationBehavior.validate({
                    location: installation.location,
                    context
                  });
                  if (validation.status !== "valid") {
                    return output(
                      ImportStatus.Failed,
                      validation.reason ?? "Installation location is unverified"
                    );
                  }
                  for (const existing of installations) {
                    if (existing.hostId !== installation.hostId) {
                      continue;
                    }
                    const comparison = yield* this.locationBehavior.compare({
                      left: installation.location,
                      right: existing.location,
                      context
                    });
                    if (comparison.status === "equal") {
                      return output(ImportStatus.Conflict, "Installation location already exists");
                    }
                    if (comparison.status !== "different") {
                      return output(
                        ImportStatus.Failed,
                        comparison.reason ?? "Installation locations cannot be compared"
                      );
                    }
                  }
                  installations.push(installation);
                }
                const flatGames = !state.documents.some(
                  (document) =>
                    document.record.kind === RecordKind.Game &&
                    basename(document.path) === "game.toml"
                );
                const entries: ImportEntry[] = yield* configurationRule(
                  "serialize-game-records",
                  () =>
                    input.games.map((game) => ({
                      path: flatGames
                        ? `games/${recordFileKey(game.id, game.uniformName, ".toml")}`
                        : `games/${recordFileKey(game.id, game.uniformName)}/game.toml`,
                      content: serializeNewConfiguration(game)
                    }))
                );
                for (const installation of input.installations) {
                  const host = state.documents.find(
                    (document) => document.record.id === installation.hostId
                  )!;
                  const previous = state.documents.filter(
                    (document) =>
                      document.record.kind === RecordKind.Installation &&
                      document.record.hostId === installation.hostId
                  );
                  const flat = previous.length
                    ? !previous.some((document) => basename(document.path) === "installation.toml")
                    : basename(host.path) !== "host.toml";
                  const parent = `${host.container}/installations`;
                  entries.push({
                    path: flat
                      ? `${parent}/${recordFileKey(installation.id, installation.uniformName, ".toml")}`
                      : `${parent}/${recordFileKey(installation.id, installation.uniformName)}/installation.toml`,
                    content: yield* configurationRule(
                      "executeImport",
                      serializeNewConfiguration,
                      installation
                    )
                  });
                }
                if (!entries.length) {
                  return output(ImportStatus.Unchanged, undefined, state.snapshot.revision);
                }
                for (const entry of entries) {
                  yield* this.checkParents(root, entry.path);
                  if (yield* this.fileSystem.inspect(join(root, entry.path))) {
                    return output(
                      ImportStatus.Conflict,
                      `Import destination exists: ${entry.path}`
                    );
                  }
                }
                if (
                  (yield* this.fileSystem.readWorkspace(input.root)).snapshot.revision !==
                  input.expectedRevision
                ) {
                  return output(ImportStatus.Conflict, "Workspace changed before import");
                }
                journal = {
                  version: 1,
                  operationId: input.operationId,
                  requestHash,
                  expectedRevision: input.expectedRevision,
                  entries,
                  before: state.documents.map(({ path, content }) => ({
                    path,
                    hash: digest(content)
                  }))
                };
                const content = JSON.stringify(journal);
                if (Buffer.byteLength(content) > 32 * 1024 * 1024) {
                  return output(ImportStatus.Failed, "Import journal exceeds byte limit");
                }
                yield* this.fileSystem.create(journalPath, content);
              }
              const beforeContents: [string, string][] = [];
              for (const before of journal.before) {
                yield* this.checkParents(root, before.path);
                const content = yield* this.fileSystem.read(
                  join(root, before.path),
                  CONFIGURATION_RECORD_BYTE_LIMIT
                );
                if (digest(content) !== before.hash) {
                  return output(
                    ImportStatus.RecoveryRequired,
                    `Existing record changed during import: ${before.path}`
                  );
                }
                beforeContents.push([before.path, content]);
              }
              if (
                `sha256:${digest(JSON.stringify(beforeContents.sort(([left], [right]) => left.localeCompare(right))))}` !==
                journal.expectedRevision
              ) {
                return output(
                  ImportStatus.RecoveryRequired,
                  "Import journal does not match its original Workspace revision"
                );
              }
              for (const entry of journal.entries) {
                yield* this.ensureDirectory(root, dirname(entry.path).split(sep).join("/"));
                const target = join(root, entry.path);
                if (yield* this.fileSystem.inspect(target)) {
                  if (
                    (yield* this.fileSystem.read(target, CONFIGURATION_RECORD_BYTE_LIMIT)) !==
                    entry.content
                  ) {
                    return output(
                      ImportStatus.RecoveryRequired,
                      `Import destination changed: ${entry.path}`
                    );
                  }
                } else {
                  yield* this.fileSystem.create(target, entry.content);
                }
              }
              const final = yield* this.fileSystem.readWorkspace(input.root);
              const expected = new Map([
                ...journal.before.map(({ path, hash }) => [path, hash] as const),
                ...journal.entries.map(({ path, content }) => [path, digest(content)] as const)
              ]);
              if (
                final.documents.length !== expected.size ||
                final.documents.some(({ path, content }) => expected.get(path) !== digest(content))
              ) {
                return output(
                  ImportStatus.RecoveryRequired,
                  "Workspace changed externally during import"
                );
              }
              yield* this.fileSystem.create(receiptPath, JSON.stringify({ requestHash }));
              yield* this.fileSystem.remove(journalPath);
              return output(ImportStatus.Imported, undefined, final.snapshot.revision);
            })
        );
      }).pipe(
        catchConfigurationResult((error) =>
          Effect.gen({ self: this }, function* () {
            return output(
              error instanceof Conflict
                ? ImportStatus.Conflict
                : error instanceof RecoveryRequired || (yield* this.fileSystem.inspect(journalPath))
                  ? ImportStatus.RecoveryRequired
                  : ImportStatus.Failed,
              String(error)
            );
          })
        )
      );
    });
  }

  private parseJournal(content: string): ImportJournal {
    const journal = assertSchema(
      "configuration.importJournalSchema",
      importJournalSchema,
      parseConfigurationJson(content)
    );
    for (const entry of journal.entries) {
      assertConfigurationRecordSize(entry.content);
      const record = assertConfigurationRecord(parseConfigurationToml(entry.content).data);
      if (record.kind !== RecordKind.Game && record.kind !== RecordKind.Installation) {
        throw ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.InvalidJournal,
            workflow: "import",
            problem: ConfigurationJournalProblem.RecordKind
          },
          "Invalid import journal record kind"
        );
      }
      const flat = entry.path.endsWith(".toml") && basename(entry.path) !== `${record.kind}.toml`;
      const key = recordFileKey(record.id, record.uniformName, flat ? ".toml" : "");
      const hostKey =
        record.kind === RecordKind.Installation ? entry.path.split("/")[1] : undefined;
      const parent = record.kind === RecordKind.Game ? "games" : `local/${hostKey}/installations`;
      const expectedPath = flat ? `${parent}/${key}` : `${parent}/${key}/${record.kind}.toml`;
      if (
        entry.path !== expectedPath ||
        (record.kind === RecordKind.Installation && !hostKey?.startsWith(`${record.hostId}-`))
      ) {
        throw ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.InvalidJournal,
            workflow: "import",
            problem: ConfigurationJournalProblem.ManagedPath
          },
          "Invalid managed import path"
        );
      }
    }
    return journal;
  }

  private checkParents(root: string, path: string) {
    return Effect.gen({ self: this }, function* () {
      if (
        !path ||
        path.includes("\\") ||
        path.includes(":") ||
        isAbsolute(path) ||
        path.split("/").some((part) => !part || part === "." || part === "..") ||
        relative(root, resolve(root, path)).startsWith("..")
      ) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.UnsafePath,
              path,
              problem: ConfigurationPathProblem.Traversal
            },
            "Unsafe managed import path"
          )
        );
      }
      let current = root;
      for (const part of path.split("/").slice(0, -1)) {
        current = join(current, part);
        const kind = yield* this.fileSystem.inspect(current);
        if (kind !== undefined && kind !== ImportPathKind.Directory) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.UnsafePath,
                path: current,
                problem: ConfigurationPathProblem.ParentNotDirectory
              },
              "Import parent links and special files are forbidden"
            )
          );
        }
      }
    });
  }

  private ensureDirectory(root: string, path: string) {
    return Effect.gen({ self: this }, function* () {
      yield* this.checkParents(root, `${path}/record`);
      let current = root;
      for (const part of path.split("/")) {
        current = join(current, part);
        if ((yield* this.fileSystem.inspect(current)) === undefined) {
          yield* this.fileSystem.mkdir(current);
        }
        if ((yield* this.fileSystem.inspect(current)) !== ImportPathKind.Directory) {
          return yield* Effect.fail(
            ConfigurationInvalidInputError.make(
              {
                kind: ConfigurationInputKind.UnsafePath,
                path: current,
                problem: ConfigurationPathProblem.ParentNotDirectory
              },
              "Import directory links are forbidden"
            )
          );
        }
      }
    });
  }
}
