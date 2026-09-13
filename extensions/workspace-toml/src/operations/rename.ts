import { basename, dirname, join } from "node:path";
import { ID_SERVICE } from "@konogame/infrastructure";
import { assertSchema } from "@konogame/infrastructure/contracts";
import {
  assertConfigurationRecord,
  ConfigurationInputKind,
  ConfigurationJournalProblem,
  ConfigurationLayoutProblem,
  ConfigurationPathProblem,
  RecordKind,
  type RenameConfigurationInput,
  type RenameConfigurationResult,
  RenameStatus,
  recordFileKey,
  uuidSchema,
  type WorkspaceConfigurationError,
  WorkspaceConflictError,
  WorkspaceConflictKind
} from "@konogame/workspace";
import { Cause, Effect } from "effect";
import { type RenameRecovery, renameRecoverySchema } from "../coordination/journals.ts";
import {
  WorkspaceWriterConflict,
  WorkspaceWriterRecoveryRequired,
  withWorkspaceWriterLock
} from "../coordination/writer-lock.ts";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink,
  type WORKSPACE_NODE_FILESYSTEM,
  writeExclusive
} from "../filesystem/node.ts";
import { WORKSPACE_IMPORT_FILESYSTEM } from "../filesystem/tokens.ts";
import { assertConfigurationRecordSize } from "../toml/limits.ts";
import { parseConfigurationToml, replaceUniformName } from "../toml/parser.ts";
import { digest, directory, exists, loadConfigurationState } from "./configuration.ts";
import {
  ConfigurationInvalidInputError,
  configurationRule,
  parseConfigurationJson
} from "./errors.ts";

const JOURNAL_LIMIT = 4 * 1024 * 1024;
const renameRule = <Args extends unknown[], A>(evaluate: (...args: Args) => A, ...args: Args) =>
  configurationRule("rename", evaluate, ...args);

export function readRecovery(root: string, path: string) {
  return Effect.gen(function* () {
    const info = yield* lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      return yield* Effect.fail(
        ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.Layout,
            path,
            problem: info.isSymbolicLink()
              ? ConfigurationLayoutProblem.Link
              : ConfigurationLayoutProblem.NotFile
          },
          "Invalid rename recovery journal"
        )
      );
    }
    if (info.size > JOURNAL_LIMIT) {
      return yield* Effect.fail(
        ConfigurationInvalidInputError.make(
          {
            kind: ConfigurationInputKind.InvalidJournal,
            workflow: "rename",
            problem: ConfigurationJournalProblem.Size,
            limit: JOURNAL_LIMIT,
            actual: info.size
          },
          "Invalid rename recovery journal: byte limit exceeded"
        )
      );
    }
    const text = yield* readFile(path, "utf8");
    const journal = yield* renameRule(
      (text: string) =>
        assertSchema(
          "configuration.renameRecoverySchema",
          renameRecoverySchema,
          parseConfigurationJson(text)
        ),
      text
    );
    const paths = [
      journal.from,
      journal.to,
      journal.temporary,
      ...journal.moves.flatMap((move) => [move.from, move.to, move.via]),
      ...journal.beforeDocuments.map((entry) => entry.path)
    ];
    for (const item of paths) {
      if (
        item.includes("\\") ||
        item.startsWith("/") ||
        item.includes(":") ||
        item.split("/").some((part) => !part || part === ".." || part === ".")
      ) {
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.UnsafePath,
              path: item,
              problem: ConfigurationPathProblem.Traversal
            },
            "Unsafe rename recovery path"
          )
        );
      }
      let parent = dirname(join(root, item));
      while (parent !== root) {
        if (yield* exists(parent)) {
          yield* directory(parent);
        }
        parent = dirname(parent);
      }
    }
    yield* renameRule(assertConfigurationRecordSize, journal.before);
    yield* renameRule(assertConfigurationRecordSize, journal.after);
    const before = yield* renameRule(
      assertConfigurationRecord,
      (yield* renameRule(parseConfigurationToml, journal.before)).data
    );
    const after = yield* renameRule(
      assertConfigurationRecord,
      (yield* renameRule(parseConfigurationToml, journal.after)).data
    );
    const invalidContent = (
      problem: Exclude<ConfigurationJournalProblem, typeof ConfigurationJournalProblem.Size>
    ) =>
      ConfigurationInvalidInputError.make(
        { kind: ConfigurationInputKind.InvalidJournal, workflow: "rename", problem },
        "Invalid rename recovery content"
      );
    if (before.id !== journal.recordId || after.id !== journal.recordId) {
      return yield* Effect.fail(invalidContent(ConfigurationJournalProblem.RecordIdentity));
    }
    if (after.kind === RecordKind.Workspace) {
      return yield* Effect.fail(invalidContent(ConfigurationJournalProblem.RecordKind));
    }
    if (
      after.uniformName !== journal.uniformName ||
      (journal.before !== journal.after &&
        (yield* renameRule(replaceUniformName, journal.before, journal.uniformName)) !==
          journal.after)
    ) {
      return yield* Effect.fail(invalidContent(ConfigurationJournalProblem.RecordSemantics));
    }
    return journal;
  });
}

function sameFile(left: string, right: string) {
  return Effect.gen(function* () {
    if (!(yield* exists(left)) || !(yield* exists(right))) {
      return false;
    }
    const a = yield* lstat(left);
    const b = yield* lstat(right);
    return a.dev === b.dev && a.ino === b.ino;
  });
}

function stagedFile(path: string, content: string) {
  return Effect.gen(function* () {
    yield* renameRule(assertConfigurationRecordSize, content);
    if (yield* exists(path)) {
      const info = yield* lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || (yield* readFile(path, "utf8")) !== content) {
        return yield* Effect.fail(
          new WorkspaceConflictError({
            issue: { kind: WorkspaceConflictKind.ExternalChange, path, phase: "rename-staging" },
            message: "Rename staging file changed externally"
          })
        );
      }
      return;
    }
    yield* writeExclusive(path, content);
  });
}

function cleanStagedFile(path: string, content: string) {
  return Effect.gen(function* () {
    if (!(yield* exists(path))) {
      return;
    }
    yield* stagedFile(path, content);
    yield* unlink(path);
  });
}

function finish(
  root: string,
  recoveryPath: string,
  journal: RenameRecovery,
  inputRoot: string,
  operationId: string,
  publish: Effect.Effect<void, WorkspaceConfigurationError, WORKSPACE_NODE_FILESYSTEM> = Effect.void
): Effect.Effect<
  RenameConfigurationResult,
  WorkspaceConfigurationError,
  WORKSPACE_NODE_FILESYSTEM
> {
  return Effect.suspend(() => {
    const output = (status: RenameStatus, reason?: string): RenameConfigurationResult => ({
      status,
      operationId,
      paths: journal.moves,
      ...(reason ? { reason } : {})
    });
    const mapped = (path: string) => {
      for (const move of journal.moves) {
        if (path === move.from || path.startsWith(`${move.from}/`)) {
          return move.to + path.slice(move.from.length);
        }
      }
      return path;
    };
    const currentPath = (path: string) =>
      Effect.gen(function* () {
        const candidates = [path, mapped(path)];
        for (const move of journal.moves) {
          if (path === move.from || path.startsWith(`${move.from}/`)) {
            candidates.push(move.via + path.slice(move.from.length));
          }
        }
        for (const candidate of candidates) {
          if (yield* exists(join(root, candidate))) {
            return candidate;
          }
        }
        return yield* Effect.fail(
          ConfigurationInvalidInputError.make(
            {
              kind: ConfigurationInputKind.Layout,
              path: path,
              problem: ConfigurationLayoutProblem.NotFile
            },
            `Rename record is missing: ${path}`
          )
        );
      });
    let recovered: RenameConfigurationResult | undefined;
    const operation = Effect.gen(function* () {
      for (const entry of journal.beforeDocuments) {
        const path = yield* currentPath(entry.path);
        const info = yield* lstat(join(root, path));
        if (!info.isFile() || info.isSymbolicLink()) {
          return output(RenameStatus.RecoveryRequired, `Record changed externally: ${path}`);
        }
        const content = yield* readFile(join(root, path), "utf8");
        if (
          digest(content) !== entry.hash &&
          !(entry.path === journal.from && content === journal.after)
        ) {
          return output(RenameStatus.RecoveryRequired, `Record changed externally: ${path}`);
        }
      }
      for (const move of journal.moves) {
        const from = yield* exists(join(root, move.from));
        const to = yield* exists(join(root, move.to));
        const via = yield* exists(join(root, move.via));
        const aliases = from && to && (yield* sameFile(join(root, move.from), join(root, move.to)));
        if ((from && to && !aliases) || (via && (from || to))) {
          return output(RenameStatus.RecoveryRequired, `Multiple rename paths exist: ${move.to}`);
        }
        if (!from && !to && !via) {
          return output(RenameStatus.RecoveryRequired, `Rename paths are missing: ${move.from}`);
        }
        if (from) {
          // The intermediate path also makes case-only moves reliable on Windows.
          yield* rename(join(root, move.from), join(root, move.via));
          yield* rename(join(root, move.via), join(root, move.to));
        } else if (via) {
          yield* rename(join(root, move.via), join(root, move.to));
        }
      }
      const current = yield* readFile(join(root, journal.to), "utf8");
      if (current !== journal.before && current !== journal.after) {
        return output(
          RenameStatus.RecoveryRequired,
          "Record changed externally before replacement"
        );
      }
      if (current !== journal.after) {
        yield* stagedFile(join(root, journal.temporary), journal.after);
        if ((yield* readFile(join(root, journal.to), "utf8")) !== journal.before) {
          return output(
            RenameStatus.RecoveryRequired,
            "Record changed externally before replacement"
          );
        }
        yield* rename(join(root, journal.temporary), join(root, journal.to));
      }
      const state = yield* loadConfigurationState(inputRoot);
      const expected = journal.beforeDocuments.map((entry) => ({
        path: mapped(entry.path),
        hash: entry.path === journal.from ? digest(journal.after) : entry.hash
      }));
      if (
        state.documents.length !== expected.length ||
        state.documents.some(
          (entry) =>
            expected.find((item) => item.path === entry.path)?.hash !== digest(entry.content)
        )
      ) {
        return output(RenameStatus.RecoveryRequired, "Workspace changed externally during rename");
      }
      yield* cleanStagedFile(join(root, `${journal.temporary}.rollback`), journal.before);
      yield* unlink(recoveryPath);
      return { ...output(RenameStatus.Renamed), revision: state.snapshot.revision };
    });
    // Publication and rollback form one bracket, including cancellation before the first move.
    return Effect.acquireUseRelease(
      publish,
      () => operation,
      (_, exit) => {
        if (exit._tag === "Success") {
          return Effect.void;
        }
        const error = Cause.squash(exit.cause);
        return Effect.gen(function* () {
          for (const entry of journal.beforeDocuments) {
            const content = yield* readFile(join(root, yield* currentPath(entry.path)), "utf8");
            if (
              digest(content) !== entry.hash &&
              !(entry.path === journal.from && content === journal.after)
            ) {
              return output(RenameStatus.RecoveryRequired, String(error));
            }
          }
          const contentPath = yield* currentPath(journal.from);
          if ((yield* readFile(join(root, contentPath), "utf8")) === journal.after) {
            const rollback = `${journal.temporary}.rollback`;
            yield* stagedFile(join(root, rollback), journal.before);
            if ((yield* readFile(join(root, contentPath), "utf8")) !== journal.after) {
              return output(
                RenameStatus.RecoveryRequired,
                "Record changed externally during rollback"
              );
            }
            yield* rename(join(root, rollback), join(root, contentPath));
          }
          for (const move of [...journal.moves].reverse()) {
            const current = (yield* exists(join(root, move.via)))
              ? move.via
              : (yield* exists(join(root, move.to)))
                ? move.to
                : move.from;
            if (current !== move.from) {
              if (
                (yield* exists(join(root, move.from))) &&
                !(yield* sameFile(join(root, current), join(root, move.from)))
              ) {
                return output(
                  RenameStatus.RecoveryRequired,
                  "Rollback destination changed externally"
                );
              }
              if (current !== move.via) {
                yield* rename(join(root, current), join(root, move.via));
              }
              yield* rename(join(root, move.via), join(root, move.from));
            }
          }
          yield* cleanStagedFile(join(root, journal.temporary), journal.after);
          yield* cleanStagedFile(join(root, `${journal.temporary}.rollback`), journal.before);
          yield* unlink(recoveryPath);
          return output(RenameStatus.Failed, String(error));
        }).pipe(
          Effect.catch((rollbackError) =>
            Effect.succeed(
              output(
                RenameStatus.RecoveryRequired,
                `${String(error)}; rollback failed: ${String(rollbackError)}`
              )
            )
          ),
          Effect.tap((result) =>
            Effect.sync(() => {
              recovered = result;
            })
          ),
          // Nested finalizers may retain only interruption; log recovery before leaving this owner scope.
          Effect.tap((result) =>
            Cause.hasInterrupts(exit.cause) && result.status === RenameStatus.RecoveryRequired
              ? Effect.logError("Workspace rename requires recovery after cancellation", {
                  operationId,
                  status: result.status,
                  reason: result.reason
                })
              : Effect.void
          ),
          Effect.asVoid
        );
      }
    ).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterrupts(cause) || Cause.hasDies(cause)
          ? Effect.failCause(cause)
          : recovered
            ? Effect.succeed(recovered)
            : Effect.failCause(cause)
      )
    );
  });
}

export function renameConfiguration(
  input: RenameConfigurationInput
): Effect.Effect<
  RenameConfigurationResult,
  WorkspaceConfigurationError,
  WORKSPACE_NODE_FILESYSTEM | WORKSPACE_IMPORT_FILESYSTEM | ID_SERVICE
> {
  return Effect.gen(function* () {
    const result = (
      status: RenameStatus,
      reason?: string,
      extra: Partial<RenameConfigurationResult> = {}
    ): RenameConfigurationResult => ({
      status,
      operationId: input.operationId,
      ...(reason ? { reason } : {}),
      ...extra
    });
    const prepared = yield* Effect.result(
      Effect.gen(function* () {
        yield* renameRule(
          (value: unknown) => assertSchema("workspace.uuid", uuidSchema, value),
          input.recordId
        );
        yield* renameRule(
          (value: unknown) => assertSchema("workspace.uuid", uuidSchema, value),
          input.operationId
        );
        yield* renameRule(recordFileKey, input.recordId, input.uniformName);
        const root = join(yield* realpath(input.root), ".konogame");
        yield* directory(root);
        return root;
      })
    );
    if (prepared._tag === "Failure") {
      return result(RenameStatus.Failed, String(prepared.failure));
    }
    const root = prepared.success;
    const directories = yield* Effect.result(
      Effect.gen(function* () {
        for (const folder of ["recovery", "recovery/rename"]) {
          const path = join(root, folder);
          if (!(yield* exists(path))) {
            yield* mkdir(path).pipe(
              Effect.catch((error) => (error.code === "EEXIST" ? Effect.void : Effect.fail(error)))
            );
          }
          yield* directory(path);
        }
      })
    );
    if (directories._tag === "Failure") {
      return result(RenameStatus.RecoveryRequired, String(directories.failure));
    }
    const lockPath = join(root, "recovery/rename/writer.lock");
    const recoveryPath = join(root, "recovery/rename/journal.json");
    if (yield* exists(lockPath)) {
      const info = yield* lstat(lockPath);
      if (!info.isFile() || info.isSymbolicLink()) {
        return result(RenameStatus.RecoveryRequired, "Invalid Workspace writer lock");
      }
    }
    const fileSystem = yield* WORKSPACE_IMPORT_FILESYSTEM;
    const token = yield* (yield* ID_SERVICE).uuidV7();
    return yield* withWorkspaceWriterLock(fileSystem, root, token, "rename", () =>
      Effect.gen(function* () {
        if (yield* exists(join(root, "recovery/import/journal.json"))) {
          return result(
            RenameStatus.RecoveryRequired,
            "A Workspace import requires recovery before rename"
          );
        }
        for (const kind of ["initialize", "edit"]) {
          if (yield* exists(join(root, `recovery/${kind}/journal.json`))) {
            return result(
              RenameStatus.RecoveryRequired,
              `A ${kind} operation requires recovery before rename`
            );
          }
        }
        if (yield* exists(recoveryPath)) {
          const journal = yield* readRecovery(root, recoveryPath);
          if (journal.recordId !== input.recordId || journal.uniformName !== input.uniformName) {
            return result(RenameStatus.RecoveryRequired, "Another rename requires recovery");
          }
          return yield* finish(root, recoveryPath, journal, input.root, input.operationId);
        }
        const state = yield* loadConfigurationState(input.root);
        if (state.snapshot.revision !== input.expectedRevision) {
          return result(RenameStatus.Conflict, "Workspace revision changed", {
            revision: state.snapshot.revision
          });
        }
        const document = state.documents.find((item) => item.record.id === input.recordId);
        if (!document || document.record.kind === RecordKind.Workspace) {
          return result(RenameStatus.Failed, "Rename requires a Game, Host or Installation record");
        }
        const flat = basename(document.path) !== `${document.record.kind}.toml`;
        const key = yield* renameRule(
          recordFileKey,
          document.record.id,
          input.uniformName,
          flat ? ".toml" : ""
        );
        const moves: RenameRecovery["moves"] = [];
        const oldContainer = document.container!;
        const newContainer = `${dirname(oldContainer).replaceAll("\\", "/")}/${flat ? key.slice(0, -5) : key}`;
        const to = flat
          ? `${dirname(document.path).replaceAll("\\", "/")}/${key}`
          : `${newContainer}/${document.record.kind}.toml`;
        if (flat && document.path !== to) {
          moves.push({ from: document.path, to, via: `recovery/rename/${token}-record` });
        }
        if (
          oldContainer !== newContainer &&
          (!flat ||
            (document.record.kind === RecordKind.Host && (yield* exists(join(root, oldContainer)))))
        ) {
          moves.push({
            from: oldContainer,
            to: newContainer,
            via: `recovery/rename/${token}-container`
          });
        }
        for (const move of moves) {
          if (
            (yield* exists(join(root, move.to))) &&
            !(yield* sameFile(join(root, move.from), join(root, move.to)))
          ) {
            return result(RenameStatus.Conflict, `Rename destination exists: ${move.to}`);
          }
        }
        if (document.record.uniformName === input.uniformName && moves.length === 0) {
          return result(RenameStatus.Unchanged, undefined, { revision: state.snapshot.revision });
        }
        const after =
          document.record.uniformName === input.uniformName
            ? document.content
            : yield* renameRule(replaceUniformName, document.content, input.uniformName);
        yield* renameRule(assertConfigurationRecordSize, after);
        yield* renameRule(
          assertConfigurationRecord,
          (yield* renameRule(parseConfigurationToml, after)).data
        );
        const journal: RenameRecovery = {
          version: 1,
          recordId: input.recordId,
          uniformName: input.uniformName,
          operationId: input.operationId,
          expectedRevision: input.expectedRevision,
          before: document.content,
          after,
          from: document.path,
          to,
          temporary: `recovery/rename/${token}.tmp`,
          moves,
          beforeDocuments: state.documents.map(({ path, content }) => ({
            path,
            hash: digest(content)
          }))
        };
        if (
          (yield* loadConfigurationState(input.root)).snapshot.revision !== input.expectedRevision
        ) {
          return result(RenameStatus.Conflict, "Workspace revision changed before rename");
        }
        return yield* finish(
          root,
          recoveryPath,
          journal,
          input.root,
          input.operationId,
          writeExclusive(recoveryPath, JSON.stringify(journal))
        );
      })
    ).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause) || Cause.hasDies(cause)) {
          return Effect.failCause(cause);
        }
        const error = Cause.squash(cause);
        if (error instanceof WorkspaceWriterConflict) {
          return Effect.succeed(result(RenameStatus.Conflict, error.message));
        }
        if (error instanceof WorkspaceWriterRecoveryRequired) {
          return Effect.succeed(result(RenameStatus.RecoveryRequired, error.message));
        }
        return Effect.gen(function* () {
          return result(
            (yield* exists(recoveryPath)) ? RenameStatus.RecoveryRequired : RenameStatus.Failed,
            String(error)
          );
        });
      })
    );
  });
}
