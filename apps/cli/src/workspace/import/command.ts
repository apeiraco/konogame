import { resolve } from "node:path";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import {
  Cancelled,
  CLI_CONTEXT,
  type CliCommandEffect,
  CliError,
  output,
  required
} from "../../context.ts";
import { type CliCommand, type CliCommandName } from "../../parser/index.ts";

type ImportCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceRecoverImport }>;

export function executeImport(command: ImportCommand): CliCommandEffect {
  return Effect.gen(function* () {
    const context = yield* CLI_CONTEXT;
    const root = resolve(yield* required(command.root, "root"));
    const operationId = yield* required(command.operationId, "operation-id");
    if (!context.interactive && !command.yes)
      return yield* Effect.fail(
        new CliError({ message: "Import recovery requires explicit confirmation with --yes" })
      );
    if (
      context.interactive &&
      !command.yes &&
      !(yield* context.prompts.confirm(`Recover interrupted import ${operationId} in ${root}?`))
    )
      return yield* Effect.fail(new Cancelled("Cancelled"));
    const result = yield* (yield* WORKSPACE_MANAGEMENT).recoverWorkspaceImport(
      { root, operationId },
      command.adapter
    );
    yield* output(result);
    if (result.status !== "imported" && result.status !== "unchanged")
      return yield* Effect.fail(new CliError({ message: `Import recovery ${result.status}` }));
  });
}
