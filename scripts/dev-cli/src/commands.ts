import { Args, Command, Flags } from "@oclif/core";
import { checkDocs } from "./docs.ts";
import { releaseCommands } from "./release-commands.ts";

class CheckDocs extends Command {
  protected override async catch(error: Error): Promise<never> {
    throw error;
  }
  static override description = "Check canonical documents, language links, and local links";
  static override args = {
    root: Args.string({
      description: "Repository root (defaults to this repository)",
      ignoreStdin: true
    })
  };
  static override flags = { help: Flags.boolean({ char: "h", description: "Show command help" }) };
  async run() {
    const { args } = await this.parse(CheckDocs);
    return checkDocs(args.root);
  }
}

export const commands: Record<string, Command.Class> = {
  "check-docs": CheckDocs,
  ...releaseCommands
};
