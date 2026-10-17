#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Config, run } from "@oclif/core";
import { outputContext } from "./runtime.ts";

export { checkDocs, repositoryRoot } from "./docs.ts";
export {
  checkRelease,
  loadMetadata,
  metadataSchema,
  notesForRelease,
  parseMetadata,
  releaseNotes,
  setReleaseVersion,
  syncRelease
} from "./release.ts";

export async function runDevCli(
  argv: string[],
  options: {
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
  } = {}
): Promise<number> {
  const stdout =
    options.stdout ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const stderr =
    options.stderr ??
    ((text: string) => {
      process.stderr.write(text);
    });
  try {
    const root = resolve(import.meta.dirname, "..");
    const pjson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    pjson.oclif.commands.target = import.meta.url.endsWith(".ts")
      ? "./src/commands.ts"
      : "./dist/commands.js";
    pjson.oclif.helpClass = import.meta.url.endsWith(".ts") ? "./src/help.ts" : "./dist/help.js";
    pjson.oclif.additionalHelpFlags = ["-h"];
    const config = await Config.load({
      root,
      pjson,
      userPlugins: false,
      devPlugins: false,
      ignoreManifest: true
    });
    const result = (await outputContext.run(stdout, () => run(argv, config))) as
      | { documents: number }
      | undefined;
    if (result)
      stdout(
        `Checked ${result.documents} canonical documents and local links, including archives.\n`
      );
    return 0;
  } catch (error) {
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runDevCli(process.argv.slice(2));
}
