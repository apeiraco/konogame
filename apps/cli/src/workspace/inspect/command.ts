import { resolve } from "node:path";
import { assertSettings, workspaceJsonSchema } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import { CLI_CONTEXT, type CliCommandEffect, cliChecked, output, required } from "../../context.ts";
import { type CliCommand, CliCommandName } from "../../parser/index.ts";

type InspectCommand = Extract<
  CliCommand,
  { kind: typeof CliCommandName.workspaceInspect | typeof CliCommandName.workspaceExplain }
>;

export function executeWorkspaceSchema() {
  return output(workspaceJsonSchema());
}

export function executeInspect(command: InspectCommand): CliCommandEffect {
  return Effect.gen(function* () {
    switch (command.kind) {
      case CliCommandName.workspaceInspect: {
        const context = yield* CLI_CONTEXT;
        const root = yield* required(command.root, "root");
        let hostId = command.hostId;
        let installationId = command.installationId;
        if (context.interactive && (hostId === undefined || installationId === undefined)) {
          const initial = yield* (yield* WORKSPACE_MANAGEMENT).inspectWorkspace(root, {
            preferredAdapterId: command.adapter
          });
          if (hostId === undefined && initial.hosts.length) {
            hostId =
              (yield* context.prompts.select("Host (optional)", [
                { value: "", label: "All records without a Host selection" },
                ...initial.hosts.map((host) => ({
                  value: host.id,
                  label: `${host.label} (${host.id})`
                }))
              ])) || undefined;
          }
          if (hostId && installationId === undefined) {
            const installations = initial.installations.filter((item) => item.hostId === hostId);
            if (installations.length)
              installationId =
                (yield* context.prompts.select("Installation (optional)", [
                  { value: "", label: "Host settings only" },
                  ...installations.map((item) => ({
                    value: item.id,
                    label: `${item.uniformName} (${item.id})`
                  }))
                ])) || undefined;
          }
        }
        return yield* output(
          yield* (yield* WORKSPACE_MANAGEMENT).inspectWorkspace(root, {
            hostId,
            installationId,
            preferredAdapterId: command.adapter
          })
        );
      }
      case CliCommandName.workspaceExplain:
        return yield* output(
          yield* (yield* WORKSPACE_MANAGEMENT).explainSettings(
            resolve(yield* required(command.root, "root")),
            {
              gameId: command.gameId,
              hostId: command.hostId,
              installationId: command.installationId,
              preferredAdapterId: command.adapter,
              ...(command.overridesJson === undefined
                ? {}
                : {
                    overrides: assertSettings(yield* cliChecked(JSON.parse, command.overridesJson))
                  })
            },
            command.feature.length ? [...command.feature] : undefined
          )
        );
    }
  });
}
