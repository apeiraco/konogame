import { argument, option } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, text } from "../../parser/shared.ts";

export const workspaceRename = "workspace rename";

export const renameParser = leaf(
  "rename",
  "Rename a Workspace record's uniform name with a revision check",
  workspaceRename,
  {
    adapter,
    root: argument(text("ROOT")).optional(),
    recordId: argument(text("RECORD")).optional(),
    uniformName: argument(text("NAME")).optional(),
    expectedRevision: option("--expected-revision", text("REVISION"), {
      description: message`Expected Workspace revision (defaults to inspected revision)`
    }).optional(),
    operationId: option("--operation-id", text("UUID"), {
      description: message`Stable UUID for retrying an operation`
    }).optional()
  }
);
