import { argument, command, integer, option, or } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, text } from "../parser/shared.ts";

export const gameDiscover = "game discover";
export const gameList = "game list";
export const gameShow = "game show";
export const gameImport = "game import";

export const gameParser = command(
  "game",
  or(
    leaf(
      "discover",
      "Preview local game candidates without writing Workspace records",
      gameDiscover,
      {
        adapter,
        root: argument(text("ROOT")).optional(),
        configurationAdapter: option("--configuration-adapter", text("ADAPTER"), {
          description: message`Require this Workspace configuration Adapter`
        }).optional(),
        hostId: option("--host-id", text("UUID"), {
          description: message`Existing Host UUID`
        }).optional(),
        sourceId: option("--source-id", text("ID"), {
          description: message`Existing Host source ID`
        }).optional(),
        scope: option("--scope", text("PATH"), {
          description: message`Explicit scan directory (repeat for multiple roots)`
        }).multiple(),
        maxDepth: option("--max-depth", integer({ min: 0, max: 16, metavar: "DEPTH" }), {
          description: message`Standalone directory depth; 0 selects each root itself`
        }).withDefault(1),
        exclude: option("--exclude", text("PREFIX"), {
          description: message`Excluded relative directory prefix (repeatable)`
        }).multiple()
      }
    ),
    leaf("list", "List library Games with their Host, source, and Installation status", gameList, {
      adapter,
      root: argument(text("ROOT")).optional(),
      hostId: option("--host-id", text("UUID"), {
        description: message`Filter by Host UUID`
      }).optional(),
      sourceId: option("--source-id", text("ID"), {
        description: message`Filter by source ID on the selected Host`
      }).optional()
    }),
    leaf("show", "Show one library Game and all of its Installations", gameShow, {
      adapter,
      root: argument(text("ROOT")).optional(),
      gameId: argument(text("GAME")).optional()
    }),
    leaf("import", "Confirm selected candidates from a saved discovery preview", gameImport, {
      root: argument(text("ROOT")).optional(),
      previewFile: argument(text("FILE")).optional(),
      candidate: option("--candidate", text("KEY"), {
        description: message`Candidate key to import (repeatable)`
      }).multiple(),
      yes: option("--yes", { description: message`Explicitly confirm Workspace writes` }),
      hostId: option("--host-id", text("UUID"), {
        description: message`Require the preview to match this Host UUID`
      }).optional(),
      sourceId: option("--source-id", text("ID"), {
        description: message`Require the preview to match this source ID`
      }).optional(),
      operationId: option("--operation-id", text("UUID"), {
        description: message`Stable UUID for retrying this import`
      }).optional()
    })
  ),
  { brief: message`Discover and import local games` }
);
