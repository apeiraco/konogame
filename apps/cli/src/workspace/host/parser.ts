import { argument, command, option } from "@optique/core";
import { message } from "@optique/core/message";
import { adapter, leaf, platform, text } from "../../parser/shared.ts";

export const workspaceHostAdd = "workspace host add";

export const hostParser = command(
  "host",
  leaf(
    "add",
    "Preview a new Host; optionally apply its reviewed creation with --apply",
    workspaceHostAdd,
    {
      adapter,
      root: argument(text("ROOT")).optional(),
      uniformName: argument(text("NAME")).optional(),
      label: option("--label", text("LABEL"), {
        description: message`Host display label`
      }).optional(),
      platform: option("--platform", platform, {
        description: message`Host platform`
      }).optional(),
      apply: option("--apply", {
        description: message`Apply this Host creation after confirmation`
      }),
      yes: option("--yes", { description: message`Confirm Host creation writes` })
    }
  ),
  { brief: message`Add a Host` }
);
