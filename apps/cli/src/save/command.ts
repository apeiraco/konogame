import { FEATURE_PLAN } from "@konogame/infrastructure";
import { SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { Effect } from "effect";
import {
  Cancelled,
  CLI_CONTEXT,
  type CliCommandEffect,
  CliError,
  cliExternal,
  output,
  required
} from "../context.ts";
import { type CliCommand, type CliCommandName } from "../parser/index.ts";

type SaveCommand = Extract<CliCommand, { kind: typeof CliCommandName.saveStore }>;

export function executeSave(command: SaveCommand): CliCommandEffect {
  return Effect.gen(function* () {
    const context = yield* CLI_CONTEXT;
    const directory = yield* required(command.directory, "directory");
    if (context.interactive && !(yield* context.prompts.confirm(`Store save from ${directory}?`)))
      return yield* Effect.fail(new Cancelled("Cancelled"));
    const plan = yield* (yield* FEATURE_PLAN).plan(
      ["save.store"],
      command.adapter ? { "save.store": command.adapter } : {}
    );
    if (!plan.bindings.length)
      return yield* Effect.fail(
        new CliError({ message: plan.unavailable[0]?.reason ?? "Save store unavailable" })
      );
    const { artifactFromDirectory } = yield* cliExternal(
      () => import("@konogame/extension-filesystem")
    );
    return yield* output(
      yield* (yield* SAVE_STORE_WORKFLOW).storeSave(
        yield* artifactFromDirectory(directory),
        command.adapter
      )
    );
  });
}
