import { SaveError } from "@konogame/save";
import { Clock, Effect, Schedule } from "effect";

/** Internal native boundary for publishing one owned staging directory. */
export interface ArtifactPublicationIO {
  readonly platform: string;
  readonly lstat: (path: string) => Promise<unknown>;
  readonly rename: (source: string, target: string) => Promise<void>;
}

function hasCode(cause: unknown, code: string): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === code;
}

function failure(operation: string, cause: unknown): SaveError {
  return new SaveError({
    operation,
    cause,
    message: cause instanceof Error ? cause.message : String(cause)
  });
}

/** Internal policy; callers retain ownership of staging and its cleanup. */
export function publishArtifact(
  source: string,
  target: string,
  io: ArtifactPublicationIO
): Effect.Effect<void, SaveError> {
  return Effect.suspend(() => {
    let lastFailure: SaveError | undefined;
    return Effect.gen(function* () {
      // The first attempt is always allowed; only subsequent starts have a 500ms window.
      const started = yield* Clock.currentTimeMillis;
      const withinBudget = Clock.currentTimeMillis.pipe(Effect.map((now) => now - started < 500));
      const attempt = Effect.gen(function* () {
        const exists = yield* Effect.tryPromise({
          try: () => io.lstat(target),
          catch: (cause) => failure("inspect-publication-target", cause)
        }).pipe(
          Effect.as(true),
          Effect.catch((error) =>
            hasCode(error.cause, "ENOENT") ? Effect.succeed(false) : Effect.fail(error)
          )
        );
        if (exists) {
          return yield* Effect.fail(
            failure(
              "publish-artifact",
              Object.assign(new Error("Artifact publication target already exists"), {
                code: "EEXIST",
                path: target
              })
            )
          );
        }
        // This guards retry starts after both backoff and lstat, not an in-flight syscall.
        if (lastFailure && !(yield* withinBudget)) return yield* Effect.fail(lastFailure);
        // Only the native syscall is masked; backoff and target inspection remain cancellable.
        yield* Effect.tryPromise({
          try: () => io.rename(source, target),
          catch: (cause) => failure("publish-artifact", cause)
        }).pipe(
          Effect.uninterruptible,
          Effect.tapError((error) =>
            Effect.sync(() => {
              lastFailure = error;
            })
          )
        );
      });
      // Windows directory rename rejects existing directories. The lstat check is
      // additional conflict detection, not a portable atomic no-replace primitive.
      return yield* Effect.retry(attempt, {
        times: 4,
        schedule: Schedule.exponential("25 millis"),
        while: (error) =>
          Effect.gen(function* () {
            return (
              io.platform === "win32" &&
              error.operation === "publish-artifact" &&
              hasCode(error.cause, "EPERM") &&
              (yield* withinBudget)
            );
          })
      });
    });
  });
}

