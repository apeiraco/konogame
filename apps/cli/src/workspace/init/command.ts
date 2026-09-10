import { resolve } from "node:path";
import { ID_SERVICE } from "@konogame/infrastructure";
import { initializeConfigurationInputSchema, WORKSPACE_SCHEMA } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import { type CliCommandEffect, CliError, cliChecked, required } from "../../context.ts";
import { type CliCommand, CliCommandName } from "../../parser/index.ts";
import { confirmWrite, successfulWrite } from "../write.ts";

type InitCommand = Extract<
  CliCommand,
  {
    kind: typeof CliCommandName.workspaceInit | typeof CliCommandName.workspaceRecoverInitialize;
  }
>;

export function executeInit(command: InitCommand): CliCommandEffect {
  return Effect.gen(function* () {
    switch (command.kind) {
      case CliCommandName.workspaceInit: {
        const root = resolve(yield* required(command.root, "root"));
        const name = yield* required(command.name, "name");
        const uniformName = yield* required(command.hostName, "host-name");
        const platform = yield* required(command.platform, "platform");
        if (!["windows", "linux", "macos"].includes(platform))
          return yield* Effect.fail(new CliError({ message: "Unsupported Host platform" }));
        yield* confirmWrite(
          command.yes,
          `Initialize ${name} in ${root} with Host ${uniformName}, platform ${platform}, and disabled history?`
        );
        const ids = yield* ID_SERVICE;
        const input = yield* cliChecked(initializeConfigurationInputSchema.assert, {
          root,
          operationId: command.operationId ?? (yield* ids.uuidV7()),
          workspace: {
            kind: "workspace" as const,
            schemaVersion: WORKSPACE_SCHEMA,
            id: yield* ids.uuidV7(),
            name,
            defaults: {},
            history: { mode: "disabled" as const }
          },
          host: {
            kind: "host",
            schemaVersion: WORKSPACE_SCHEMA,
            id: yield* ids.uuidV7(),
            uniformName,
            label: command.hostLabel ?? uniformName,
            platform,
            roots: {},
            defaults: {},
            gameOverrides: {},
            sources: []
          }
        });
        return yield* successfulWrite(
          yield* (yield* WORKSPACE_MANAGEMENT).initialize(input, command.adapter)
        );
      }
      case CliCommandName.workspaceRecoverInitialize: {
        const root = resolve(yield* required(command.root, "root"));
        const operationId = yield* required(command.operationId, "operation-id");
        yield* confirmWrite(command.yes, `Recover initialization ${operationId} in ${root}?`);
        return yield* successfulWrite(
          yield* (yield* WORKSPACE_MANAGEMENT).recoverInitialize(
            { root, operationId },
            command.adapter
          )
        );
      }
    }
  });
}
