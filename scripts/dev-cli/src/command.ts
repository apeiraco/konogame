import { executeDocs } from "./docs/command.ts";
import { type DevCommand, DevCommandName } from "./parser/index.ts";
import { executeRelease } from "./release/command.ts";

export function executeDevCommand(command: DevCommand) {
  switch (command.kind) {
    case DevCommandName.checkDocs:
      return executeDocs(command);
    case DevCommandName.releaseShow:
    case DevCommandName.releaseCheck:
    case DevCommandName.releaseSync:
    case DevCommandName.releaseVersion:
    case DevCommandName.releaseNotes:
      return executeRelease(command);
  }
}
