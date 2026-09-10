import { argument, option } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, text } from "../../parser/shared.ts";

export const workspaceRecoverImport = "workspace recover-import";

export const importParser = leaf(
  "recover-import",
  "Recover an interrupted game import from its existing journal",
  workspaceRecoverImport,
  {
    adapter,
    root: argument(text("ROOT")).optional(),
    operationId: argument(text("UUID")).optional(),
    yes: option("--yes", { description: message`Explicitly confirm import recovery writes` })
  }
);
