import { or } from "@optique/core";
import { type InferValue } from "@optique/core/parser";
import { features, featuresParser, plan, planParser } from "../catalog/parser.ts";
import {
  extensionList,
  extensionParser,
  extensionRefresh,
  extensionStatus
} from "../extension/parser.ts";
import { gameDiscover, gameImport, gameList, gameParser, gameShow } from "../game/parser.ts";
import { saveParser, saveStore } from "../save/parser.ts";
import {
  workspaceEditApply,
  workspaceEditPreview,
  workspaceEditRecover
} from "../workspace/edit/parser.ts";
import { workspaceHostAdd } from "../workspace/host/parser.ts";
import { workspaceRecoverImport } from "../workspace/import/parser.ts";
import { workspaceInit, workspaceRecoverInitialize } from "../workspace/init/parser.ts";
import {
  workspaceExplain,
  workspaceInspect,
  workspaceSchema
} from "../workspace/inspect/parser.ts";
import { workspaceParser } from "../workspace/parser.ts";
import { workspaceRename } from "../workspace/rename/parser.ts";

export const CliCommandName = {
  extensionList,
  extensionStatus,
  extensionRefresh,
  features,
  plan,
  saveStore,
  workspaceSchema,
  workspaceInit,
  workspaceHostAdd,
  workspaceEditPreview,
  workspaceEditApply,
  workspaceEditRecover,
  workspaceRecoverInitialize,
  workspaceInspect,
  workspaceExplain,
  workspaceRename,
  workspaceRecoverImport,
  gameDiscover,
  gameList,
  gameShow,
  gameImport
} as const;

export const cliCommandMenu = [
  CliCommandName.extensionList,
  CliCommandName.extensionStatus,
  CliCommandName.extensionRefresh,
  CliCommandName.features,
  CliCommandName.plan,
  CliCommandName.saveStore,
  CliCommandName.workspaceSchema,
  CliCommandName.workspaceInit,
  CliCommandName.workspaceHostAdd,
  CliCommandName.workspaceEditPreview,
  CliCommandName.workspaceEditApply,
  CliCommandName.workspaceEditRecover,
  CliCommandName.workspaceRecoverInitialize,
  CliCommandName.workspaceInspect,
  CliCommandName.workspaceExplain,
  CliCommandName.workspaceRename,
  CliCommandName.workspaceRecoverImport,
  CliCommandName.gameDiscover,
  CliCommandName.gameList,
  CliCommandName.gameShow,
  CliCommandName.gameImport
] as const;

export const cliParser = or(
  extensionParser,
  featuresParser,
  planParser,
  saveParser,
  workspaceParser,
  gameParser
);

export type CliCommand = InferValue<typeof cliParser>;

export function normalizeCliTokens(argv: readonly string[]) {
  const boundary = argv.indexOf("--");
  const options = boundary < 0 ? argv : argv.slice(0, boundary);
  const positional = boundary < 0 ? [] : argv.slice(boundary);
  return [
    ...options.map((arg) =>
      arg === "--interactive=true"
        ? "--interactive"
        : arg === "--interactive=false"
          ? "--non-interactive"
          : arg
    ),
    ...positional
  ];
}
