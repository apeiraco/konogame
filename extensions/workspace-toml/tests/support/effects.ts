import assert from "node:assert/strict";
import { Cause, Effect, Exit } from "effect";

// Native fixture preparation remains a real Promise boundary; business workflows return Effect directly.
export const nativePromise = <A>(promise: Promise<A>): Effect.Effect<A> =>
  Effect.promise(() => promise);
export function rejects<A, E, R>(
  input: Effect.Effect<A, E, R> | (() => Effect.Effect<A, E, R>),
  expected?: string | RegExp
) {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(typeof input === "function" ? Effect.suspend(input) : input);
    assert(Exit.isFailure(exit), "Expected an Effect failure");
    const reason = Cause.pretty(exit.cause);
    if (expected instanceof RegExp) {
      assert.match(reason, expected);
    } else if (expected !== undefined) {
      assert(reason.includes(expected), reason);
    }
  });
}
