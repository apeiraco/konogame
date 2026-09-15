import { Cause, Effect, Exit } from "effect";

/** The TanStack and browser boundaries receive original typed failures. */
export async function runUiEffect<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect, { signal });
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  for (const reason of exit.cause.reasons) {
    if (Cause.isDieReason(reason)) {
      throw reason.defect;
    }
  }
  if (exit.cause.reasons.some(Cause.isInterruptReason)) {
    throw Cause.squash(exit.cause);
  }
  for (const reason of exit.cause.reasons) {
    if (Cause.isFailReason(reason)) {
      throw reason.error;
    }
  }
  throw Cause.squash(exit.cause);
}
