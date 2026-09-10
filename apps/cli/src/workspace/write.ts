import { Effect } from "effect";
import { Cancelled, CLI_CONTEXT, CliError, output } from "../context.ts";

export function confirmWrite(yes: boolean, message: string) {
  return Effect.gen(function* () {
    const context = yield* CLI_CONTEXT;
    if (!context.interactive && !yes)
      return yield* Effect.fail(
        new CliError({ message: "Workspace writes require explicit confirmation with --yes" })
      );
    if (context.interactive && !yes && !(yield* context.prompts.confirm(message)))
      return yield* Effect.fail(new Cancelled("Cancelled"));
  });
}

export function successfulWrite(result: { status: string }) {
  return Effect.gen(function* () {
    yield* output(result);
    if (!["initialized", "edited", "unchanged"].includes(result.status))
      return yield* Effect.fail(new CliError({ message: `Workspace write ${result.status}` }));
  });
}
