import { expect, it } from "@effect/vitest";
import { Cause, Deferred, Effect, Fiber, Layer } from "effect";
import { CLI_PROMPTS, runCli } from "../main.ts";

it.live("interrupting CLI menu preserves cancellation and closes its prompt scope", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let finalizers = 0;
    let stderr = "";
    const overrides = Layer.succeed(CLI_PROMPTS, {
      text: () => Effect.die(new Error("Unexpected text prompt")),
      confirm: () => Effect.die(new Error("Unexpected confirmation")),
      select: () =>
        Effect.acquireUseRelease(
          Deferred.succeed(started, undefined),
          () => Effect.never,
          () =>
            Effect.sync(() => {
              finalizers++;
            })
        )
    });
    const fiber = yield* runCli([], {
      env: {},
      isTTY: true,
      overrides,
      stdout: () => {},
      stderr: (text) => {
        stderr += text;
      }
    }).pipe(Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(finalizers).toBe(1);
    expect(stderr).toBe("");
  })
);
