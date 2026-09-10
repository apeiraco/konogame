import { argument } from "@optique/core";
import { adapter, leaf, text } from "../parser/shared.ts";

export const features = "features";
export const plan = "plan";

export const featuresParser = leaf("features", "List available Features", features, {});
export const planParser = leaf("plan", "Resolve a Feature's Binding Plan", plan, {
  adapter,
  feature: argument(text("FEATURE")).optional(),
  adapterId: argument(text("ADAPTER")).optional()
});
