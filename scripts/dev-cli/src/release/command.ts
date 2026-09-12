import { Effect } from "effect";
import { output } from "../context.ts";
import { type DevCommand, DevCommandName } from "../parser/index.ts";
import { checkRelease } from "./check.ts";
import { loadMetadata } from "./metadata.ts";
import { notesForRelease } from "./notes.ts";
import { syncRelease } from "./sync.ts";
import { setReleaseVersion } from "./version.ts";

type ReleaseCommand = Exclude<DevCommand, { kind: typeof DevCommandName.checkDocs }>;

export function executeRelease(command: ReleaseCommand) {
  switch (command.kind) {
    case DevCommandName.releaseShow:
      return loadMetadata(command.root).pipe(Effect.flatMap(output));
    case DevCommandName.releaseCheck:
      return checkRelease(command.root).pipe(Effect.flatMap(output));
    case DevCommandName.releaseSync:
      return syncRelease(command.root, command.dryRun).pipe(Effect.flatMap(output));
    case DevCommandName.releaseVersion:
      return setReleaseVersion(command.version, {
        root: command.root,
        extensionId: command.extension,
        dryRun: command.dryRun
      }).pipe(Effect.flatMap(output));
    case DevCommandName.releaseNotes:
      return notesForRelease({
        root: command.root,
        language: command.lang,
        version: command.version,
        extensionId: command.extension
      }).pipe(
        Effect.flatMap((notes) => output(command.json ? { language: command.lang, notes } : notes))
      );
  }
}
