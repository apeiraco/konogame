import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { provideTestCli, testCliContext } from "../../__tests__/support/context.ts";
import { Cancelled } from "../../context.ts";
import { type CliCommand, CliCommandName } from "../../parser/index.ts";
import { executeSave } from "../command.ts";

type SaveCommand = Extract<CliCommand, { kind: typeof CliCommandName.saveStore }>;

function command(overrides: Partial<SaveCommand> = {}): SaveCommand {
  return {
    kind: CliCommandName.saveStore,
    json: true,
    interactive: false,
    nonInteractive: false,
    directory: "saves",
    ...overrides
  } as SaveCommand;
}

it.effect("a declined confirmation never plans or stores", () =>
  Effect.gen(function* () {
    let plans = 0;
    let stores = 0;
    const io = testCliContext({ interactive: true, confirm: () => Effect.succeed(false) });
    const exit = yield* Effect.exit(
      provideTestCli(executeSave(command()), io.context, {
        plan: {
          plan: () => {
            plans++;
            return Effect.succeed({
              contractVersion: "0.2.0",
              bindings: [{ adapterId: "fixture.store" }],
              unavailable: []
            });
          }
        },
        save: {
          storeSave: () => {
            stores++;
            return Effect.succeed({ id: "artifact", mediaType: "application/octet-stream" });
          }
        }
      })
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") expect(Cause.squash(exit.cause)).toBeInstanceOf(Cancelled);
    expect(plans).toBe(0);
    expect(stores).toBe(0);
  })
);

it.effect("cancelling the missing-directory prompt stops before planning", () =>
  Effect.gen(function* () {
    let plans = 0;
    const io = testCliContext({
      interactive: true,
      text: () => Effect.fail(new Cancelled())
    });
    const exit = yield* Effect.exit(
      provideTestCli(executeSave(command({ directory: undefined })), io.context, {
        plan: {
          plan: () => {
            plans++;
            return Effect.succeed({ contractVersion: "0.2.0", bindings: [], unavailable: [] });
          }
        }
      })
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") expect(Cause.squash(exit.cause)).toBeInstanceOf(Cancelled);
    expect(plans).toBe(0);
  })
);
