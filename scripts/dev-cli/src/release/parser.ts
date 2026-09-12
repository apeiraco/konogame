import { argument, command, constant, object, option, or } from "@optique/core";
import { message } from "@optique/core/message";
import { dryRun, json, root, text } from "../parser/shared.ts";

export const releaseShow = "release show";
export const releaseCheck = "release check";
export const releaseSync = "release sync";
export const releaseVersion = "release version";
export const releaseNotesCommand = "release notes";

export const releaseParser = command(
  "release",
  or(
    command("show", object({ kind: constant(releaseShow), root, json }), {
      brief: message`Show canonical project, declaration protocol, Port, and Extension metadata`
    }),
    command("check", object({ kind: constant(releaseCheck), root, json }), {
      brief: message`Check release versions, compatibility declarations, generated sources, and bilingual notes`
    }),
    command("sync", object({ kind: constant(releaseSync), root, json, dryRun }), {
      brief: message`Synchronize manifests and release metadata from the canonical TOML source`
    }),
    command(
      "version",
      object({
        kind: constant(releaseVersion),
        version: argument(text("VERSION")),
        root,
        json,
        extension: option("--extension", text("ID"), {
          description: message`Extension ID; omit to update core only`
        }).optional(),
        dryRun
      }),
      {
        brief: message`Set the shared core version, or one independently released Extension version`
      }
    ),
    command(
      "notes",
      object({
        kind: constant(releaseNotesCommand),
        root,
        json,
        version: option("--version", text("VERSION"), {
          description: message`Exact release version; defaults to the selected group's current version`
        }).optional(),
        extension: option("--extension", text("ID"), {
          description: message`Extension ID; omit to read core release notes`
        }).optional(),
        lang: option("--lang", text("LANG"), {
          description: message`Changelog language`
        }).withDefault("en")
      }),
      {
        brief: message`Extract one exact core or Extension release section from a canonical changelog`
      }
    )
  ),
  { brief: message`Maintain canonical release metadata` }
);
