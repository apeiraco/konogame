import { or } from "@optique/core";
import { type InferValue } from "@optique/core/parser";
import { checkDocsKind, docsParser } from "../docs/parser.ts";
import {
  releaseCheck,
  releaseNotesCommand,
  releaseParser,
  releaseShow,
  releaseSync,
  releaseVersion
} from "../release/parser.ts";

export const DevCommandName = {
  checkDocs: checkDocsKind,
  releaseShow,
  releaseCheck,
  releaseSync,
  releaseVersion,
  releaseNotes: releaseNotesCommand
} as const;

export const devParser = or(docsParser, releaseParser);

export type DevCommand = InferValue<typeof devParser>;
