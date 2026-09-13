import { join } from "node:path";
import {
  type WorkspaceWriterConflictFailure,
  type WorkspaceWriterRecoveryFailure
} from "@konogame/workspace";
import { Cause, Data, Effect, Exit, Option } from "effect";
import { configurationRule, parseConfigurationJson } from "../operations/errors.ts";
import { type WorkspaceImportFileSystem } from "../operations/import.ts";
import { accept, writerLockSchema } from "./journals.ts";

export class WorkspaceWriterConflict
  extends Data.TaggedError("WorkspaceWriterConflict")<{
    readonly message: string;
  }>
  implements WorkspaceWriterConflictFailure
{
  constructor(message: string) {
    super({ message });
  }
}
export class WorkspaceWriterRecoveryRequired
  extends Data.TaggedError("WorkspaceWriterRecoveryRequired")<{
    readonly message: string;
    readonly cause?: unknown;
  }>
  implements WorkspaceWriterRecoveryFailure
{
  constructor(message: string, cause?: unknown) {
    super({ message, cause });
  }
}

export function withWorkspaceWriterLock<A, E, R>(
  fileSystem: WorkspaceImportFileSystem,
  root: string,
  operationId: string,
  own: string,
  action: () => Effect.Effect<A, E, R>
) {
  return Effect.suspend(() => {
    const path = join(root, "recovery/rename/writer.lock");
    let owned = false;
    const acquire = Effect.gen(function* () {
      if (yield* fileSystem.inspect(path)) {
        const prior = yield* fileSystem.read(path, 4096);
        const lock = yield* configurationRule("writer-lock", () =>
          accept(writerLockSchema, parseConfigurationJson(prior))
        );
        if (!lock) {
          return yield* Effect.fail(
            new WorkspaceWriterRecoveryRequired("Invalid Workspace writer lock owner")
          );
        }
        if (yield* fileSystem.processAlive(lock.pid)) {
          return yield* Effect.fail(new WorkspaceWriterConflict("Workspace writer lock is held"));
        }
        if ((yield* fileSystem.read(path, 4096)) !== prior) {
          return yield* Effect.fail(new WorkspaceWriterConflict("Workspace writer lock changed"));
        }
        yield* fileSystem.remove(path);
      }
      const created = yield* Effect.exit(
        fileSystem.create(path, JSON.stringify({ pid: fileSystem.processId, token: operationId }))
      );
      if (Exit.isFailure(created)) {
        const failure = Cause.findErrorOption(created.cause);
        // A concurrent request with the same operation ID must never adopt an existing lock.
        if (Option.isSome(failure) && failure.value.code === "EEXIST") {
          return yield* Effect.fail(new WorkspaceWriterConflict("Workspace writer lock is held"));
        }
        // Publication may succeed before injected code or staging cleanup reports failure.
        yield* fileSystem.read(path, 4096).pipe(
          Effect.flatMap((content) =>
            configurationRule("writer-lock", () =>
              accept(writerLockSchema, parseConfigurationJson(content))
            )
          ),
          Effect.tap((lock) =>
            Effect.sync(() => {
              owned = lock?.pid === fileSystem.processId && lock.token === operationId;
            })
          ),
          Effect.catch(() => Effect.void)
        );
        return yield* Effect.failCause(created.cause);
      }
      owned = true;
    });
    return Effect.acquireUseRelease(
      Effect.exit(acquire),
      (acquired) =>
        Effect.gen(function* () {
          if (Exit.isFailure(acquired)) {
            return yield* Effect.failCause(acquired.cause);
          }
          for (const kind of ["initialize", "edit", "rename", "import"]) {
            if (
              kind !== own &&
              (yield* fileSystem.inspect(join(root, `recovery/${kind}/journal.json`)))
            ) {
              return yield* Effect.fail(
                new WorkspaceWriterRecoveryRequired(`A ${kind} operation requires recovery first`)
              );
            }
          }
          return yield* action();
        }),
      () =>
        !owned
          ? Effect.void
          : Effect.gen(function* () {
              const content = yield* fileSystem.read(path, 4096);
              const lock = yield* configurationRule("release-writer-lock", () =>
                accept(writerLockSchema, parseConfigurationJson(content))
              );
              if (lock?.token !== operationId || lock.pid !== fileSystem.processId) {
                return yield* Effect.fail(
                  new WorkspaceWriterRecoveryRequired(
                    "Workspace writer lock owner changed; manual inspection is required"
                  )
                );
              }
              yield* fileSystem.remove(path);
            }).pipe(
              Effect.tapCause((cause) =>
                Effect.logError("Workspace writer lock requires recovery", {
                  operationId,
                  phase: "writer-lock-release",
                  status: "recovery-required",
                  reason: Cause.pretty(cause)
                })
              ),
              Effect.mapError(
                (cause) =>
                  new WorkspaceWriterRecoveryRequired(
                    "Operation may already be published; Workspace writer lock cleanup failed and requires recovery",
                    cause
                  )
              )
            )
    );
  });
}

// Interruption and defects keep their complete Cause; only ordinary failures become domain results.
export function catchConfigurationResult<E, B, E2, R2>(
  recover: (error: E | WorkspaceWriterRecoveryRequired) => Effect.Effect<B, E2, R2>
) {
  return <A, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catchCause((cause): Effect.Effect<B, E | E2, R2> => {
        if (Cause.hasInterrupts(cause) || Cause.hasDies(cause)) {
          return Effect.failCause(cause);
        }
        const recovery = cause.reasons.find(
          (reason) =>
            Cause.isFailReason(reason) && reason.error instanceof WorkspaceWriterRecoveryRequired
        );
        if (recovery && Cause.isFailReason(recovery)) {
          const reason = cause.reasons
            .filter(Cause.isFailReason)
            .map(({ error }) => {
              if (!(error instanceof Error)) {
                return String(error);
              }
              return error instanceof WorkspaceWriterRecoveryRequired &&
                error.cause instanceof Error
                ? `${error.message}: ${error.cause.message}`
                : error.message;
            })
            .join("; ");
          return recover(new WorkspaceWriterRecoveryRequired(reason, cause));
        }
        const error = Cause.findErrorOption(cause);
        return Option.isSome(error) ? recover(error.value) : Effect.failCause(cause);
      })
    );
}
