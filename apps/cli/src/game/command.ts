import { resolve } from "node:path";
import { GAME_ADMISSION, gameDiscoveryPreviewSchema } from "@konogame/game/admission";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import {
  Cancelled,
  CLI_CONTEXT,
  type CliCommandEffect,
  CliError,
  cliChecked,
  output,
  required
} from "../context.ts";
import { type CliCommand, CliCommandName } from "../parser/index.ts";
import { readBoundedJson } from "../preview.ts";

type GameCommand = Extract<
  CliCommand,
  {
    kind:
      | typeof CliCommandName.gameDiscover
      | typeof CliCommandName.gameList
      | typeof CliCommandName.gameShow
      | typeof CliCommandName.gameImport;
  }
>;

export function executeGame(command: GameCommand): CliCommandEffect {
  return Effect.gen(function* () {
    switch (command.kind) {
      case CliCommandName.gameDiscover: {
        const root = resolve(yield* required(command.root, "root"));
        const hostId = yield* required(command.hostId, "host-id");
        const sourceId = yield* required(command.sourceId, "source-id");
        const paths = command.scope.length ? command.scope : [yield* required(undefined, "scope")];
        return yield* output(
          yield* (yield* GAME_ADMISSION).preview({
            root,
            hostId,
            sourceId,
            scope: {
              paths: paths.map((path) => resolve(path)),
              maxDepth: command.maxDepth,
              exclude: [...command.exclude]
            },
            ...(command.adapter === undefined ? {} : { preferredAdapterId: command.adapter }),
            ...(command.configurationAdapter === undefined
              ? {}
              : { configurationAdapterId: command.configurationAdapter })
          })
        );
      }
      case CliCommandName.gameList:
        return yield* output(
          yield* (yield* WORKSPACE_MANAGEMENT).listGames(
            resolve(yield* required(command.root, "root")),
            {
              hostId: command.hostId,
              sourceId: command.sourceId,
              preferredAdapterId: command.adapter
            }
          )
        );
      case CliCommandName.gameShow: {
        const root = resolve(yield* required(command.root, "root"));
        const gameId = yield* required(command.gameId, "game-id");
        return yield* output(
          yield* (yield* WORKSPACE_MANAGEMENT).showGame(root, gameId, command.adapter)
        );
      }
      case CliCommandName.gameImport: {
        const context = yield* CLI_CONTEXT;
        const root = resolve(yield* required(command.root, "root"));
        const previewFile = yield* required(command.previewFile, "preview-file");
        if (!context.interactive && !command.yes)
          return yield* Effect.fail(
            new CliError({ message: "Game import requires explicit confirmation with --yes" })
          );
        const selected = [...new Set(command.candidate)];
        if (!context.interactive && !selected.length)
          return yield* Effect.fail(
            new CliError({ message: "Select at least one candidate with --candidate" })
          );
        const preview = yield* readBoundedJson(previewFile);
        if (context.interactive && !selected.length) {
          const validated = yield* cliChecked(gameDiscoveryPreviewSchema.assert, preview);
          yield* context.stderr(
            `Workspace: ${root}; candidates: ${validated.candidates.length}; diagnostics: ${validated.diagnostics.length}\n`
          );
          const remaining = [...validated.candidates];
          while (remaining.length) {
            const value = yield* context.prompts.select("Candidate to import", [
              ...remaining.map((item) => ({
                value: item.key,
                label: `${item.title} — ${item.disposition} — ${item.location.type}: ${JSON.stringify(item.location.data)}`
              })),
              ...(selected.length ? [{ value: "", label: "Finish selection" }] : [])
            ]);
            if (!value) break;
            selected.push(value);
            const index = remaining.findIndex((item) => item.key === value);
            if (index < 0)
              return yield* Effect.fail(new CliError({ message: "Unknown candidate selection" }));
            remaining.splice(index, 1);
          }
        }
        if (!selected.length)
          return yield* Effect.fail(new CliError({ message: "No candidates selected" }));
        if (
          context.interactive &&
          !command.yes &&
          !(yield* context.prompts.confirm(
            `Import ${selected.length} selected candidate(s) into ${root}?`
          ))
        )
          return yield* Effect.fail(new Cancelled("Cancelled"));
        const result = yield* (yield* GAME_ADMISSION).import({
          root,
          preview,
          selectedCandidateKeys: selected,
          operationId: command.operationId,
          hostId: command.hostId,
          sourceId: command.sourceId
        });
        yield* output(result);
        if (result.status !== "imported" && result.status !== "unchanged")
          return yield* Effect.fail(new CliError({ message: `Game import ${result.status}` }));
        return;
      }
    }
  });
}
