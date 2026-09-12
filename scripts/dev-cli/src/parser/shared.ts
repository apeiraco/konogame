import { type NonEmptyString, option, string } from "@optique/core";
import { message } from "@optique/core/message";

export const text = (metavar: NonEmptyString) => string({ metavar });
export const root = option("--root", text("ROOT"), {
  description: message`Repository root (defaults to this repository)`
}).optional();
export const json = option("--json", { description: message`Write structured JSON output` });
export const dryRun = option("--dry-run", {
  description: message`Preview changed paths without writing`
});
