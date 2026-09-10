import { argument, option } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, platform, text } from "../../parser/shared.ts";

export const workspaceInit = "workspace init";
export const workspaceRecoverInitialize = "workspace recover-initialize";

export const initParser = leaf(
  "init",
  "Initialize Workspace metadata in an existing directory with disabled history",
  workspaceInit,
  {
    adapter,
    root: argument(text("ROOT")).optional(),
    name: option("--name", text("NAME"), {
      description: message`Workspace display name`
    }).optional(),
    hostName: option("--host-name", text("NAME"), {
      description: message`Initial Host uniform name`
    }).optional(),
    hostLabel: option("--host-label", text("LABEL"), {
      description: message`Initial Host display label (defaults to its name)`
    }).optional(),
    platform: option("--platform", platform, {
      description: message`Initial Host platform`
    }).optional(),
    operationId: option("--operation-id", text("UUID"), {
      description: message`Stable UUID for explicit recovery`
    }).optional(),
    yes: option("--yes", { description: message`Confirm initialization writes` })
  }
);

export const recoverInitializeParser = leaf(
  "recover-initialize",
  "Explicitly recover interrupted Workspace initialization using its journal",
  workspaceRecoverInitialize,
  {
    adapter,
    root: argument(text("ROOT")).optional(),
    operationId: argument(text("UUID")).optional(),
    yes: option("--yes", { description: message`Confirm journal recovery writes` })
  }
);
