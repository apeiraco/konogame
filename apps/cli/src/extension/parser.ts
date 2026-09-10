import { argument, command, or } from "@optique/core";
import { message } from "@optique/core/message";
import { leaf, text } from "../parser/shared.ts";

export const extensionList = "extension list";
export const extensionStatus = "extension status";
export const extensionRefresh = "extension refresh";

export const extensionParser = command(
  "extension",
  or(
    leaf(
      "list",
      "List installed Extension declarations without loading their code",
      extensionList,
      {}
    ),
    leaf("status", "Inspect Extension registration, activation, and diagnostics", extensionStatus, {
      id: argument(text("ID")).optional()
    }),
    leaf(
      "refresh",
      "Rescan installed Extensions for this process and report the catalog delta",
      extensionRefresh,
      {}
    )
  ),
  { brief: message`Inspect and refresh installed Extensions` }
);
