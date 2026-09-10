import { argument, command } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, text } from "../parser/shared.ts";

export const saveStore = "save store";

export const saveParser = command(
  "save",
  leaf("store", "Stream a save directory into the local store", saveStore, {
    adapter,
    directory: argument(text("DIRECTORY")).optional()
  }),
  { brief: message`Store a local save directory` }
);
