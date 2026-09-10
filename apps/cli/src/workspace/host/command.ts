import { resolve } from "node:path";
import { ID_SERVICE } from "@konogame/infrastructure";
import { configurationEditChangeSchema, WORKSPACE_SCHEMA } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import { CLI_CONTEXT, type CliCommandEffect, cliChecked, output, required } from "../../context.ts";
import { type CliCommand, type CliCommandName } from "../../parser/index.ts";
import { confirmWrite, successfulWrite } from "../write.ts";

type HostCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceHostAdd }>;

export function executeHost(command: HostCommand): CliCommandEffect {
  return Effect.gen(function* () {
    const context = yield* CLI_CONTEXT;
    const root = resolve(yield* required(command.root, "root"));
    const uniformName = yield* required(command.uniformName, "uniform-name");
    const change = yield* cliChecked(configurationEditChangeSchema.assert, {
      kind: "host.create",
      host: {
        kind: "host",
        schemaVersion: WORKSPACE_SCHEMA,
        id: yield* (yield* ID_SERVICE).uuidV7(),
        uniformName,
        label: command.label ?? uniformName,
        platform: yield* required(command.platform, "platform"),
        roots: {},
        defaults: {},
        gameOverrides: {},
        sources: []
      }
    });
    const workspace = yield* WORKSPACE_MANAGEMENT;
    const preview = yield* workspace.preview({
      root,
      change,
      preferredAdapterId: command.adapter
    });
    if (!command.apply) return yield* output(preview);
    if (context.interactive)
      yield* context.stderr(`${JSON.stringify(preview.differences, null, 2)}\n`);
    yield* confirmWrite(command.yes, `Create Host ${uniformName} in ${root}?`);
    return yield* successfulWrite(yield* workspace.apply({ root, preview }));
  });
}
