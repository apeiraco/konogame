import { argument, option } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, text } from "../../parser/shared.ts";

export const workspaceSchema = "workspace schema";
export const workspaceInspect = "workspace inspect";
export const workspaceExplain = "workspace explain";

export const schemaParser = leaf(
  "schema",
  "Export the current Workspace JSON Schema",
  workspaceSchema,
  {}
);

export const inspectParser = leaf(
  "inspect",
  "Inspect Workspace records and effective settings",
  workspaceInspect,
  {
    adapter,
    root: argument(text("ROOT")).optional(),
    hostId: argument(text("HOST")).optional(),
    installationId: argument(text("INSTALLATION")).optional()
  }
);

export const explainParser = leaf(
  "explain",
  "Explain seven settings layers, origins, clears, and Adapter availability",
  workspaceExplain,
  {
    adapter,
    root: argument(text("ROOT")).optional(),
    gameId: option("--game-id", text("UUID"), {
      description: message`Select a library Game UUID`
    }).optional(),
    hostId: option("--host-id", text("UUID"), {
      description: message`Select a Host UUID`
    }).optional(),
    installationId: option("--installation-id", text("UUID"), {
      description: message`Select an Installation UUID and its Host`
    }).optional(),
    feature: option("--feature", text("FEATURE"), {
      description: message`Feature to explain (repeatable)`
    }).multiple(),
    overridesJson: option("--overrides-json", text("JSON"), {
      description: message`Invocation settings as a strict JSON object`
    }).optional()
  }
);
