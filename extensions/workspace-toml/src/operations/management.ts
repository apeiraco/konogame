import { basename, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assertSchema } from "@konogame/infrastructure/contracts";
import {
  applyConfigurationEdit,
  assertConfigurationRecord,
  ConfigurationEditKind,
  ConfigurationInputKind,
  ConfigurationPathProblem,
  type ConfigurationRecord,
  type EditConfigurationInput,
  EditStatus,
  editConfigurationInputSchema,
  type InitializeConfigurationInput,
  InitializeStatus,
  initializeConfigurationInputSchema,
  materializeRecord,
  RecordKind,
  type RecoverEditConfigurationInput,
  type RecoverInitializeConfigurationInput,
  recordFileKey,
  recoverEditConfigurationInputSchema,
  recoverInitializeConfigurationInputSchema,
  type WorkspaceConfigurationError,
  WorkspaceInvalidInputError,
  WorkspaceInvalidInputKind,
  type WorkspaceSnapshot
} from "@konogame/workspace";
import { Effect } from "effect";
import {
  accept,
  editJournalSchema,
  initializeJournalSchema,
  operationReceiptSchema
} from "../coordination/journals.ts";
import {
  WorkspaceWriterConflict as Conflict,
  catchConfigurationResult,
  WorkspaceWriterRecoveryRequired as RecoveryRequired,
  withWorkspaceWriterLock
} from "../coordination/writer-lock.ts";
import { editConfigurationToml } from "../toml/edit.ts";
import { assertConfigurationRecordSize, CONFIGURATION_RECORD_BYTE_LIMIT } from "../toml/limits.ts";
import { parseConfigurationToml } from "../toml/parser.ts";
import { digest } from "./configuration.ts";
import {
  ConfigurationInvalidInputError,
  configurationRule,
  parseConfigurationJson
} from "./errors.ts";
import {
  ImportPathKind,
  serializeNewConfiguration,
  type WorkspaceImportFileSystem
} from "./import.ts";

export interface WorkspaceManagementFileSystem extends WorkspaceImportFileSystem {
  readWorkspace(
    root: string,
    options?: { pendingHostContainer?: string; pendingHostContent?: string }
  ): ReturnType<WorkspaceImportFileSystem["readWorkspace"]>;
  reserveDirectory(path: string): Effect.Effect<void, WorkspaceConfigurationError>;
  replace(
    path: string,
    content: string,
    expectedContent: string,
    operationId: string
  ): Effect.Effect<void, WorkspaceConfigurationError>;
  cleanReplacement(
    path: string,
    content: string,
    operationId: string
  ): Effect.Effect<void, WorkspaceConfigurationError>;
}
const INIT_IGNORE = "/local/\n/cache/\n/recovery/\n.konogame-edit-*.tmp*\n";
const JOURNAL_LIMIT = 16 * 1024 * 1024;
type EditJournal = {
  version: 1;
  input: Omit<EditConfigurationInput, "root">;
  path: string;
  before?: string;
  after: string;
  documents: { path: string; hash: string }[];
};
const revision = (documents: { path: string; content: string }[]) =>
  `sha256:${digest(JSON.stringify(documents.map(({ path, content }) => [path, content]).sort(([left], [right]) => left!.localeCompare(right!))))}`;

export class WorkspaceConfigurationManager {
  constructor(private readonly fileSystem: WorkspaceManagementFileSystem) {}

  initialize(raw: InitializeConfigurationInput) {
    return Effect.gen({ self: this }, function* () {
      let reserved = false;
      let input = raw;
      return yield* Effect.gen({ self: this }, function* () {
        input = yield* configurationRule(
          "initialize",
          (value: unknown) =>
            assertSchema(
              "configuration.initializeConfigurationInputSchema",
              initializeConfigurationInputSchema,
              value
            ),
          raw
        );
        const root = yield* this.fileSystem.canonicalRoot(input.root);
        input = { ...input, root };
        // Validate and stage every allowed document before publishing any record.
        yield* configurationRule("initialize", this.initialEntries.bind(this), input);
        const configurationRoot = join(root, ".konogame");
        yield* this.fileSystem
          .reserveDirectory(configurationRoot)
          .pipe(
            Effect.catch((error) =>
              Effect.fail(
                error._tag === "WorkspaceFileSystemError" && error.code === "EEXIST"
                  ? new Conflict(
                      "Workspace configuration already exists; use recover-initialize for a pending initialization. An incomplete directory without its journal requires manual inspection"
                    )
                  : error
              )
            )
          );
        reserved = true;
        yield* this.prepare(configurationRoot);
        return yield* this.withLock(configurationRoot, input.operationId, "initialize", () =>
          Effect.gen({ self: this }, function* () {
            yield* this.fileSystem.create(
              join(configurationRoot, "recovery/initialize/journal.json"),
              JSON.stringify({ version: 1, input: this.withoutRoot(input) })
            );
            return yield* this.finishInitialize(input, configurationRoot);
          })
        );
      }).pipe(
        catchConfigurationResult((error) =>
          Effect.succeed({
            status: reserved
              ? InitializeStatus.RecoveryRequired
              : error instanceof Conflict
                ? InitializeStatus.Conflict
                : InitializeStatus.Failed,
            operationId: raw.operationId,
            reason: `${String(error)}${reserved ? "; initialization may be incomplete; recover with the original operation ID, or inspect manually if its journal is absent" : ""}`
          })
        )
      );
    });
  }

  recoverInitialize(raw: RecoverInitializeConfigurationInput) {
    return Effect.gen({ self: this }, function* () {
      return yield* Effect.gen({ self: this }, function* () {
        const request = yield* configurationRule(
          "recoverInitialize",
          (value: unknown) =>
            assertSchema(
              "configuration.recoverInitializeConfigurationInputSchema",
              recoverInitializeConfigurationInputSchema,
              value
            ),
          raw
        );
        const root = yield* this.fileSystem.canonicalRoot(request.root);
        const configurationRoot = join(root, ".konogame");
        yield* this.requireDirectory(configurationRoot);
        yield* this.prepare(configurationRoot);
        return yield* this.withLock(configurationRoot, request.operationId, "initialize", () =>
          Effect.gen({ self: this }, function* () {
            const path = join(configurationRoot, "recovery/initialize/journal.json");
            if (!(yield* this.fileSystem.inspect(path))) {
              const receiptPath = join(
                configurationRoot,
                `recovery/initialize/${request.operationId}.json`
              );
              if (!(yield* this.fileSystem.inspect(receiptPath))) {
                return yield* Effect.fail(
                  new RecoveryRequired(
                    "No initialization journal exists; inspect the incomplete directory manually"
                  )
                );
              }
              const receipt = yield* configurationRule(
                "recoverInitialize",
                this.parseInitialize.bind(this),
                yield* this.fileSystem.read(receiptPath, JOURNAL_LIMIT),
                root
              );
              if (receipt.operationId !== request.operationId) {
                return yield* Effect.fail(
                  new RecoveryRequired("Initialization receipt operation differs")
                );
              }
              return yield* this.verifyInitialized(receipt, configurationRoot);
            }
            const input = yield* configurationRule(
              "recoverInitialize",
              this.parseInitialize.bind(this),
              yield* this.fileSystem.read(path, JOURNAL_LIMIT),
              root
            );
            if (input.operationId !== request.operationId) {
              return yield* Effect.fail(
                new RecoveryRequired("Another initialization requires recovery")
              );
            }
            return yield* this.finishInitialize(input, configurationRoot);
          })
        );
      }).pipe(
        catchConfigurationResult((error) =>
          Effect.succeed({
            status:
              error instanceof Conflict
                ? InitializeStatus.Conflict
                : InitializeStatus.RecoveryRequired,
            operationId: raw.operationId,
            reason: String(error)
          })
        )
      );
    });
  }

  edit(raw: EditConfigurationInput) {
    return Effect.gen({ self: this }, function* () {
      let input = raw;
      let journalExists = false;
      let pendingJournalPath: string | undefined;
      return yield* Effect.gen({ self: this }, function* () {
        input = yield* configurationRule(
          "edit",
          (value: unknown) =>
            assertSchema(
              "configuration.editConfigurationInputSchema",
              editConfigurationInputSchema,
              value
            ),
          raw
        );
        const root = yield* this.fileSystem.canonicalRoot(input.root);
        input = { ...input, root };
        const configurationRoot = join(root, ".konogame");
        yield* this.requireDirectory(configurationRoot);
        yield* this.prepare(configurationRoot);
        pendingJournalPath = join(configurationRoot, "recovery/edit/journal.json");
        return yield* this.withLock(configurationRoot, input.operationId, "edit", () =>
          Effect.gen({ self: this }, function* () {
            const journalPath = join(configurationRoot, "recovery/edit/journal.json");
            if (yield* this.fileSystem.inspect(journalPath)) {
              return yield* Effect.fail(
                new RecoveryRequired("An edit requires explicit recovery before another edit")
              );
            }
            const receiptPath = join(configurationRoot, `recovery/edit/${input.operationId}.json`);
            if (yield* this.fileSystem.inspect(receiptPath)) {
              const receipt = accept(
                operationReceiptSchema,
                yield* configurationRule(
                  "edit",
                  parseConfigurationJson,
                  yield* this.fileSystem.read(receiptPath, 4096)
                )
              );
              if (!receipt) {
                return yield* Effect.fail(
                  ConfigurationInvalidInputError.make(
                    {
                      kind: ConfigurationInputKind.Receipt,
                      workflow: "edit",
                      operationId: input.operationId
                    },
                    "Invalid edit receipt"
                  )
                );
              }
              if (receipt.requestHash !== digest(JSON.stringify(this.withoutRoot(input)))) {
                return yield* Effect.fail(
                  new Conflict("Operation ID was used for a different edit")
                );
              }
              return {
                status: EditStatus.Unchanged,
                operationId: input.operationId,
                revision: (yield* this.fileSystem.readWorkspace(root)).snapshot.revision
              };
            }
            const state = yield* this.fileSystem.readWorkspace(root);
            if (state.snapshot.revision !== input.expectedRevision) {
              return yield* Effect.fail(
                new Conflict("Workspace revision changed; review a new preview")
              );
            }
            const plan = yield* configurationRule(
              "edit",
              applyConfigurationEdit,
              state.snapshot,
              input.change
            );
            if (!plan.differences.length) {
              yield* this.createOrVerify(
                receiptPath,
                JSON.stringify({
                  requestHash: digest(JSON.stringify(this.withoutRoot(input)))
                })
              );
              return {
                status: EditStatus.Unchanged,
                operationId: input.operationId,
                revision: state.snapshot.revision,
                recordId: plan.after.id
              };
            }
            const document = state.documents.find((entry) => entry.record.id === plan.after.id);
            const path =
              document?.path ??
              `local/${recordFileKey(plan.after.id, yield* configurationRule("host-name", this.hostUniformName.bind(this), plan.after))}/host.toml`;
            yield* this.checkParents(configurationRoot, path);
            if (!document && (yield* this.fileSystem.inspect(join(configurationRoot, path)))) {
              return yield* Effect.fail(new Conflict("New Host destination already exists"));
            }
            const after = document
              ? yield* configurationRule(
                  "edit",
                  editConfigurationToml,
                  document.content,
                  plan.after
                )
              : yield* configurationRule("edit", serializeNewConfiguration, plan.after);
            yield* configurationRule("edit", assertConfigurationRecordSize, after);
            yield* configurationRule(
              "edit",
              assertConfigurationRecord,
              (yield* configurationRule("edit", parseConfigurationToml, after)).data
            );
            const journal: EditJournal = {
              version: 1,
              input: this.withoutRoot(input),
              path,
              ...(document ? { before: document.content } : {}),
              after,
              documents: state.documents.map(({ path, content }) => ({
                path,
                hash: digest(content)
              }))
            };
            const content = JSON.stringify(journal);
            if (Buffer.byteLength(content) > JOURNAL_LIMIT) {
              return yield* Effect.fail(
                ConfigurationInvalidInputError.make(
                  {
                    kind: ConfigurationInputKind.Limit,
                    subject: "edit-journal",
                    limit: JOURNAL_LIMIT,
                    actual: Buffer.byteLength(JSON.stringify(journal), "utf8")
                  },
                  "Edit journal exceeds byte limit"
                )
              );
            }
            if (
              (yield* this.fileSystem.readWorkspace(root)).snapshot.revision !==
              input.expectedRevision
            ) {
              return yield* Effect.fail(new Conflict("Workspace changed before edit"));
            }
            yield* this.fileSystem.create(journalPath, content);
            journalExists = true;
            return yield* this.finishEdit(journal, root, configurationRoot);
          })
        );
      }).pipe(
        catchConfigurationResult((error) =>
          Effect.gen({ self: this }, function* () {
            if (pendingJournalPath && !journalExists) {
              journalExists = yield* this.fileSystem.inspect(pendingJournalPath).pipe(
                Effect.map(Boolean),
                Effect.catch(() => Effect.succeed(true))
              );
            }
            return {
              status:
                error instanceof Conflict
                  ? EditStatus.Conflict
                  : journalExists || error instanceof RecoveryRequired
                    ? EditStatus.RecoveryRequired
                    : EditStatus.Failed,
              operationId: raw.operationId,
              reason: String(error)
            };
          })
        )
      );
    });
  }

  recoverEdit(raw: RecoverEditConfigurationInput) {
    return Effect.gen({ self: this }, function* () {
      return yield* Effect.gen({ self: this }, function* () {
        const request = yield* configurationRule(
          "recoverEdit",
          (value: unknown) =>
            assertSchema(
              "configuration.recoverEditConfigurationInputSchema",
              recoverEditConfigurationInputSchema,
              value
            ),
          raw
        );
        const root = yield* this.fileSystem.canonicalRoot(request.root);
        const configurationRoot = join(root, ".konogame");
        yield* this.requireDirectory(configurationRoot);
        yield* this.prepare(configurationRoot);
        return yield* this.withLock(configurationRoot, request.operationId, "edit", () =>
          Effect.gen({ self: this }, function* () {
            const path = join(configurationRoot, "recovery/edit/journal.json");
            if (!(yield* this.fileSystem.inspect(path))) {
              const receiptPath = join(
                configurationRoot,
                `recovery/edit/${request.operationId}.json`
              );
              if (!(yield* this.fileSystem.inspect(receiptPath))) {
                return yield* Effect.fail(
                  new RecoveryRequired("No edit journal or completed receipt exists")
                );
              }
              const receipt = accept(
                operationReceiptSchema,
                yield* configurationRule(
                  "recoverEdit",
                  parseConfigurationJson,
                  yield* this.fileSystem.read(receiptPath, 4096)
                )
              );
              if (!receipt) {
                return yield* Effect.fail(new RecoveryRequired("Invalid edit receipt"));
              }
              return {
                status: EditStatus.Unchanged,
                operationId: request.operationId,
                revision: (yield* this.fileSystem.readWorkspace(root)).snapshot.revision
              };
            }
            const journal = yield* configurationRule(
              "recoverEdit",
              this.parseEdit.bind(this),
              yield* this.fileSystem.read(path, JOURNAL_LIMIT),
              root
            );
            if (journal.input.operationId !== request.operationId) {
              return yield* Effect.fail(new RecoveryRequired("Another edit requires recovery"));
            }
            return yield* this.finishEdit(journal, root, configurationRoot);
          })
        );
      }).pipe(
        catchConfigurationResult((error) =>
          Effect.succeed({
            status: error instanceof Conflict ? EditStatus.Conflict : EditStatus.RecoveryRequired,
            operationId: raw.operationId,
            reason: String(error)
          })
        )
      );
    });
  }

  private initialEntries(input: InitializeConfigurationInput): { path: string; content: string }[] {
    return [
      { path: ".gitignore", content: INIT_IGNORE },
      {
        path: `local/${recordFileKey(input.host.id, input.host.uniformName)}/host.toml`,
        content: serializeNewConfiguration(input.host)
      },
      {
        path: "workspace.toml",
        content: serializeNewConfiguration(input.workspace)
      }
    ];
  }

  private finishInitialize(input: InitializeConfigurationInput, configurationRoot: string) {
    return Effect.gen({ self: this }, function* () {
      const entries = yield* configurationRule(
        "finishInitialize",
        this.initialEntries.bind(this),
        input
      );
      for (const [index, entry] of entries.entries()) {
        yield* this.createOrVerify(
          join(configurationRoot, `recovery/initialize/${input.operationId}-${index}.stage`),
          entry.content
        );
      }
      for (const entry of entries) {
        yield* this.ensureParents(configurationRoot, entry.path);
        yield* this.createOrVerify(join(configurationRoot, entry.path), entry.content);
      }
      const result = yield* this.verifyInitialized(input, configurationRoot);
      const receipt = join(configurationRoot, `recovery/initialize/${input.operationId}.json`);
      yield* this.createOrVerify(
        receipt,
        JSON.stringify({ version: 1, input: this.withoutRoot(input) })
      );
      yield* this.fileSystem.remove(join(configurationRoot, "recovery/initialize/journal.json"));
      return result;
    });
  }

  private verifyInitialized(input: InitializeConfigurationInput, configurationRoot: string) {
    return Effect.gen({ self: this }, function* () {
      for (const entry of yield* configurationRule(
        "verifyInitialized",
        this.initialEntries.bind(this),
        input
      )) {
        yield* this.checkParents(configurationRoot, entry.path);
        if (
          (yield* this.fileSystem.read(
            join(configurationRoot, entry.path),
            CONFIGURATION_RECORD_BYTE_LIMIT
          )) !== entry.content
        ) {
          return yield* Effect.fail(
            new RecoveryRequired(`Initialization destination changed externally: ${entry.path}`)
          );
        }
      }
      const state = yield* this.fileSystem.readWorkspace(input.root);
      if (
        state.documents.length !== 2 ||
        state.snapshot.workspace.id !== input.workspace.id ||
        state.snapshot.hosts[0]?.id !== input.host.id
      ) {
        return yield* Effect.fail(
          new RecoveryRequired("Workspace changed externally during initialization")
        );
      }
      return {
        status: InitializeStatus.Initialized,
        operationId: input.operationId,
        revision: state.snapshot.revision,
        workspaceId: input.workspace.id,
        hostId: input.host.id
      };
    });
  }

  private parseInitialize(content: string, root: string): InitializeConfigurationInput {
    const journal = assertSchema(
      "configuration.initializeJournalSchema",
      initializeJournalSchema,
      parseConfigurationJson(content)
    );
    return assertSchema(
      "configuration.initializeConfigurationInputSchema",
      initializeConfigurationInputSchema,
      {
        ...journal.input,
        root
      }
    );
  }

  private parseEdit(content: string, root: string): EditJournal {
    const journal = assertSchema(
      "configuration.editJournalSchema",
      editJournalSchema,
      parseConfigurationJson(content)
    );
    const { root: _, ...input } = assertSchema(
      "configuration.editConfigurationInputSchema",
      editConfigurationInputSchema,
      {
        ...journal.input,
        root
      }
    );
    assertConfigurationRecordSize(journal.after);
    if (journal.before !== undefined) {
      assertConfigurationRecordSize(journal.before);
    }
    return { ...journal, input };
  }

  private finishEdit(journal: EditJournal, root: string, configurationRoot: string) {
    return Effect.gen({ self: this }, function* () {
      yield* this.checkParents(configurationRoot, journal.path);
      const after = yield* configurationRule(
        "finishEdit",
        assertConfigurationRecord,
        materializeRecord(
          (yield* configurationRule("finishEdit", parseConfigurationToml, journal.after)).data
        )
      );
      const before =
        journal.before === undefined
          ? undefined
          : yield* configurationRule(
              "finishEdit",
              assertConfigurationRecord,
              materializeRecord(
                (yield* configurationRule("finishEdit", parseConfigurationToml, journal.before))
                  .data
              )
            );
      if (
        !before &&
        (journal.input.change.kind !== ConfigurationEditKind.HostCreate ||
          (yield* configurationRule(
            "finishEdit",
            serializeNewConfiguration,
            journal.input.change.host
          )) !== journal.after ||
          after.kind !== RecordKind.Host ||
          journal.path !== `local/${recordFileKey(after.id, after.uniformName)}/host.toml`)
      ) {
        return yield* Effect.fail(
          new RecoveryRequired("Invalid new Host journal intent or destination")
        );
      }
      // Only this approved Host container, empty or holding matching staging files, may be ignored.
      const state = yield* this.fileSystem.readWorkspace(
        root,
        !before
          ? {
              pendingHostContainer: `local/${recordFileKey(after.id, yield* configurationRule("host-name", this.hostUniformName.bind(this), after))}`,
              pendingHostContent: journal.after
            }
          : undefined
      );
      const target = state.documents.find((entry) => entry.path === journal.path);
      if (before) {
        if (
          !target ||
          target.record.id !== before.id ||
          before.id !== after.id ||
          before.kind !== after.kind
        ) {
          return yield* Effect.fail(new RecoveryRequired("Edit record identity changed"));
        }
        if (target.content !== journal.before && target.content !== journal.after) {
          return yield* Effect.fail(new RecoveryRequired("Edit destination changed externally"));
        }
      } else {
        if (
          after.kind !== RecordKind.Host ||
          journal.path !== `local/${recordFileKey(after.id, after.uniformName)}/host.toml`
        ) {
          return yield* Effect.fail(new RecoveryRequired("Invalid new Host journal destination"));
        }
        if (target && target.content !== journal.after) {
          return yield* Effect.fail(
            new RecoveryRequired("New Host destination changed externally")
          );
        }
      }
      const original = this.originalSnapshot(state.snapshot, before, after.id);
      const plan = yield* configurationRule(
        "finishEdit",
        applyConfigurationEdit,
        original,
        journal.input.change
      );
      const expectedContent = before
        ? yield* configurationRule("finishEdit", editConfigurationToml, journal.before!, plan.after)
        : yield* configurationRule("finishEdit", serializeNewConfiguration, plan.after);
      if (
        expectedContent !== journal.after ||
        !isDeepStrictEqual(
          yield* configurationRule(
            "finishEdit",
            parseConfigurationJson,
            JSON.stringify(plan.after)
          ),
          yield* configurationRule("finishEdit", parseConfigurationJson, JSON.stringify(after))
        )
      ) {
        return yield* Effect.fail(
          new RecoveryRequired("Edit journal differs from its validated intent")
        );
      }
      const originalDocuments = state.documents
        .filter((entry) => entry.path !== journal.path)
        .map(({ path, content }) => ({ path, content }));
      if (before) {
        originalDocuments.push({
          path: journal.path,
          content: journal.before!
        });
      }
      if (
        revision(originalDocuments) !== journal.input.expectedRevision ||
        originalDocuments.length !== journal.documents.length ||
        originalDocuments.some(
          ({ path, content }) =>
            journal.documents.find((entry) => entry.path === path)?.hash !== digest(content)
        )
      ) {
        return yield* Effect.fail(
          new RecoveryRequired("Workspace changed externally; edit recovery stopped")
        );
      }
      if (target?.content !== journal.after) {
        if (before) {
          yield* this.fileSystem.replace(
            join(configurationRoot, journal.path),
            journal.after,
            journal.before!,
            journal.input.operationId
          );
        } else {
          yield* this.ensureParents(configurationRoot, journal.path);
          yield* this.fileSystem.create(join(configurationRoot, journal.path), journal.after);
        }
      }
      const final = yield* this.fileSystem.readWorkspace(root);
      const expected = new Map(
        originalDocuments.map(({ path, content }) => [path, digest(content)])
      );
      expected.set(journal.path, digest(journal.after));
      if (
        final.documents.length !== expected.size ||
        final.documents.some(({ path, content }) => expected.get(path) !== digest(content))
      ) {
        return yield* Effect.fail(new RecoveryRequired("Workspace changed externally during edit"));
      }
      yield* this.fileSystem.cleanReplacement(
        join(configurationRoot, journal.path),
        journal.after,
        journal.input.operationId
      );
      yield* this.createOrVerify(
        join(configurationRoot, `recovery/edit/${journal.input.operationId}.json`),
        JSON.stringify({ requestHash: digest(JSON.stringify(journal.input)) })
      );
      yield* this.fileSystem.remove(join(configurationRoot, "recovery/edit/journal.json"));
      return {
        status: EditStatus.Edited,
        operationId: journal.input.operationId,
        recordId: after.id,
        revision: final.snapshot.revision
      };
    });
  }

  private originalSnapshot(
    snapshot: WorkspaceSnapshot,
    before: ConfigurationRecord | undefined,
    id: string
  ): WorkspaceSnapshot {
    return {
      ...snapshot,
      workspace: before?.kind === RecordKind.Workspace ? before : snapshot.workspace,
      games: snapshot.games.map((entry) =>
        entry.id === id && before?.kind === RecordKind.Game ? before : entry
      ),
      hosts: before
        ? snapshot.hosts.map((entry) =>
            entry.id === id && before.kind === RecordKind.Host ? before : entry
          )
        : snapshot.hosts.filter((entry) => entry.id !== id),
      installations: snapshot.installations.map((entry) =>
        entry.id === id && before?.kind === RecordKind.Installation ? before : entry
      )
    };
  }

  private hostUniformName(record: ConfigurationRecord): string {
    if (record.kind !== RecordKind.Host) {
      throw new WorkspaceInvalidInputError({
        issue: {
          kind: WorkspaceInvalidInputKind.TargetKind,
          recordId: record.id,
          expectedKind: RecordKind.Host,
          actualKind: record.kind
        },
        message: "Only a Host may be created by edit"
      });
    }
    return record.uniformName;
  }

  private withoutRoot<T extends { root: string }>(input: T): Omit<T, "root"> {
    const { root: _, ...request } = input;
    return request;
  }

  private createOrVerify(path: string, content: string) {
    return Effect.gen({ self: this }, function* () {
      if (yield* this.fileSystem.inspect(path)) {
        if ((yield* this.fileSystem.read(path, JOURNAL_LIMIT)) !== content) {
          return yield* Effect.fail(
            new RecoveryRequired(`Managed destination changed externally: ${basename(path)}`)
          );
        }
      } else {
        yield* this.fileSystem.create(path, content);
      }
    });
  }

  private requireDirectory(path: string) {
    return Effect.gen({ self: this }, function* () {
      if ((yield* this.fileSystem.inspect(path)) !== ImportPathKind.Directory) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.UnsafePath,
              path,
              problem: ConfigurationPathProblem.ParentNotDirectory
            },
            "Management directory links and special files are forbidden"
          )
        );
      }
    });
  }

  private checkParents(root: string, path: string) {
    return Effect.gen({ self: this }, function* () {
      if (
        !path ||
        path.includes("\\") ||
        path.includes(":") ||
        path.split("/").some((part) => !part || part === "." || part === "..")
      ) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.UnsafePath,
              path,
              problem: ConfigurationPathProblem.Traversal
            },
            "Unsafe management path"
          )
        );
      }
      let current = root;
      yield* this.requireDirectory(current);
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
              "Management parent links are forbidden"
            )
          );
        }
      }
    });
  }

  private ensureParents(root: string, path: string) {
    return Effect.gen({ self: this }, function* () {
      yield* this.checkParents(root, path);
      let current = root;
      for (const part of path.split("/").slice(0, -1)) {
        current = join(current, part);
        yield* this.fileSystem.mkdir(current);
        yield* this.requireDirectory(current);
      }
    });
  }

  private prepare(root: string) {
    return Effect.gen({ self: this }, function* () {
      for (const path of [
        "recovery/rename/writer.lock",
        "recovery/initialize/journal.json",
        "recovery/edit/journal.json"
      ]) {
        yield* this.ensureParents(root, path);
      }
    });
  }

  private withLock<T, E, R>(
    root: string,
    operationId: string,
    own: string,
    action: () => Effect.Effect<T, E, R>
  ) {
    return withWorkspaceWriterLock(this.fileSystem, root, operationId, own, action);
  }
}
