import { Args, Command, Flags } from "@oclif/core";
import {
  checkRelease,
  loadMetadata,
  notesForRelease,
  setReleaseVersion,
  syncRelease
} from "./release.ts";
import { outputContext } from "./runtime.ts";

const commonFlags = {
  root: Flags.string({ description: "Repository root (defaults to this repository)" }),
  json: Flags.boolean({ description: "Write structured JSON output" }),
  help: Flags.boolean({ char: "h", description: "Show command help" })
};
function output(value: unknown): void {
  const write = outputContext.getStore();
  if (!write) throw new Error("Release command requires an output context");
  write(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`);
}
abstract class ReleaseCommand extends Command {
  protected override async catch(error: Error): Promise<never> {
    throw error;
  }
}
class ReleaseShow extends ReleaseCommand {
  static override description = "Show canonical project, Contract, and Extension metadata";
  static override flags = commonFlags;
  async run() {
    const { flags } = await this.parse(ReleaseShow);
    output(await loadMetadata(flags.root));
  }
}
class ReleaseCheck extends ReleaseCommand {
  static override description =
    "Check release versions, compatibility declarations, generated sources, and bilingual notes";
  static override flags = commonFlags;
  async run() {
    const { flags } = await this.parse(ReleaseCheck);
    output(await checkRelease(flags.root));
  }
}
class ReleaseSync extends ReleaseCommand {
  static override description =
    "Synchronize manifests and runtime metadata from the canonical TOML source";
  static override flags = {
    ...commonFlags,
    "dry-run": Flags.boolean({ description: "Preview changed paths without writing" })
  };
  async run() {
    const { flags } = await this.parse(ReleaseSync);
    output(await syncRelease(flags.root, flags["dry-run"]));
  }
}
class ReleaseVersion extends ReleaseCommand {
  static override description =
    "Set the shared core version, or one independently released Extension version";
  static override args = {
    version: Args.string({
      required: true,
      ignoreStdin: true,
      description: "Exact SemVer version, including an optional prerelease"
    })
  };
  static override flags = {
    ...commonFlags,
    extension: Flags.string({ description: "Extension ID; omit to update core only" }),
    "dry-run": Flags.boolean({ description: "Preview changed paths without writing" })
  };
  async run() {
    const { args, flags } = await this.parse(ReleaseVersion);
    output(
      await setReleaseVersion(args.version, {
        root: flags.root,
        extensionId: flags.extension,
        dryRun: flags["dry-run"]
      })
    );
  }
}
class ReleaseNotes extends ReleaseCommand {
  static override description =
    "Extract one exact core or Extension release section from a canonical changelog";
  static override flags = {
    ...commonFlags,
    version: Flags.string({
      description: "Exact release version; defaults to the selected group's current version"
    }),
    extension: Flags.string({ description: "Extension ID; omit to read core release notes" }),
    lang: Flags.string({ default: "en", description: "Changelog language" })
  };
  async run() {
    const { flags } = await this.parse(ReleaseNotes);
    const notes = await notesForRelease({
      root: flags.root,
      language: flags.lang,
      version: flags.version,
      extensionId: flags.extension
    });
    output(flags.json ? { language: flags.lang, notes } : notes);
  }
}

export const releaseCommands: Record<string, Command.Class> = {
  "release:show": ReleaseShow,
  "release:check": ReleaseCheck,
  "release:sync": ReleaseSync,
  "release:version": ReleaseVersion,
  "release:notes": ReleaseNotes
};
