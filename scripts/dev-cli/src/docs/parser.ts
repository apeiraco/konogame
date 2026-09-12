import { argument, command, constant, object } from "@optique/core";
import { message } from "@optique/core/message";
import { text } from "../parser/shared.ts";

export const checkDocsKind = "check-docs";

export const docsParser = command(
  "check-docs",
  object({
    kind: constant(checkDocsKind),
    root: argument(text("ROOT")).optional()
  }),
  { brief: message`Check canonical documents, language links, and local links` }
);
