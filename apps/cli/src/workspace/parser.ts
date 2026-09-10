import { command, or } from "@optique/core";
import { message } from "@optique/core/message";
import { editParser } from "./edit/parser.ts";
import { hostParser } from "./host/parser.ts";
import { importParser } from "./import/parser.ts";
import { initParser, recoverInitializeParser } from "./init/parser.ts";
import { explainParser, inspectParser, schemaParser } from "./inspect/parser.ts";
import { renameParser } from "./rename/parser.ts";

export const workspaceParser = command(
  "workspace",
  or(
    schemaParser,
    initParser,
    hostParser,
    editParser,
    recoverInitializeParser,
    inspectParser,
    explainParser,
    renameParser,
    importParser
  ),
  { brief: message`Read and change Workspace configuration` }
);
