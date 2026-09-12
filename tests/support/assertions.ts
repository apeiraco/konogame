import assert from "node:assert/strict";
import { Cause, Effect, Exit, Fiber } from "effect";
export function assertFailure<A, E, R>(effect: Effect.Effect<A, E, R>, pattern?: string | RegExp) {
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(effect);
    assert.ok(Exit.isFailure(exit), "Expected the Effect to fail");
    if (Cause.hasInterrupts(exit.cause)) {
      return yield* Effect.failCause(
        Cause.fromReasons<never>(exit.cause.reasons.filter(Cause.isInterruptReason))
      );
    }
    const message = Cause.pretty(exit.cause);
    if (typeof pattern === "string") {
      assert.ok(message.includes(pattern), `${message} does not contain ${pattern}`);
    } else if (pattern) {
      assert.match(message, pattern);
    }
  });
}
export function assertInterrupted<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    assert.ok(Exit.isFailure(exit));
    assert.ok(Cause.hasInterrupts(exit.cause));
  });
}
