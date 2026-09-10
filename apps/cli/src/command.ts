import { Effect } from "effect";
import { executeCatalog } from "./catalog/command.ts";
import { type Cancelled, CliError, type CliServices } from "./context.ts";
import { executeExtension } from "./extension/command.ts";
import { executeGame } from "./game/command.ts";
import { type CliCommand, CliCommandName } from "./parser/index.ts";
import { executeSave } from "./save/command.ts";
import { executeEdit } from "./workspace/edit/command.ts";
import { executeHost } from "./workspace/host/command.ts";
import { executeImport } from "./workspace/import/command.ts";
import { executeInit } from "./workspace/init/command.ts";
import { executeInspect, executeWorkspaceSchema } from "./workspace/inspect/command.ts";
import { executeRename } from "./workspace/rename/command.ts";

export { executeWorkspaceSchema };

export function executeCli(
  command: Exclude<CliCommand, { kind: typeof CliCommandName.workspaceSchema }>
): Effect.Effect<void, CliError | Cancelled, CliServices> {
  return executeBody(command).pipe(
    Effect.mapError(CliError.from),
    Effect.catchDefect((error) => Effect.fail(CliError.from(error)))
  );
}

function executeBody(
  command: Exclude<CliCommand, { kind: typeof CliCommandName.workspaceSchema }>
): Effect.Effect<void, unknown, CliServices> {
  switch (command.kind) {
    case CliCommandName.extensionList:
    case CliCommandName.extensionStatus:
    case CliCommandName.extensionRefresh:
      return executeExtension(command);
    case CliCommandName.features:
    case CliCommandName.plan:
      return executeCatalog(command);
    case CliCommandName.saveStore:
      return executeSave(command);
    case CliCommandName.workspaceInit:
    case CliCommandName.workspaceRecoverInitialize:
      return executeInit(command);
    case CliCommandName.workspaceHostAdd:
      return executeHost(command);
    case CliCommandName.workspaceEditPreview:
    case CliCommandName.workspaceEditApply:
    case CliCommandName.workspaceEditRecover:
      return executeEdit(command);
    case CliCommandName.workspaceInspect:
    case CliCommandName.workspaceExplain:
      return executeInspect(command);
    case CliCommandName.workspaceRename:
      return executeRename(command);
    case CliCommandName.workspaceRecoverImport:
      return executeImport(command);
    case CliCommandName.gameDiscover:
    case CliCommandName.gameList:
    case CliCommandName.gameShow:
    case CliCommandName.gameImport:
      return executeGame(command);
  }
}
