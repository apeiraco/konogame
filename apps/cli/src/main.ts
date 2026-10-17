#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalApplication } from "@konogame/local-runtime";
import { Config, run } from "@oclif/core";
import {
  Cancelled,
  type CliRuntime,
  cliContext,
  interactionFlags,
  interactionPolicy,
  type Prompts,
  terminalPrompts
} from "./runtime.ts";

export { Cancelled, interactionPolicy, type Prompts } from "./runtime.ts";

export interface CliOptions {
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  application?: CliRuntime["app"];
  prompts?: Prompts;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export async function runCli(argv: string[], options: CliOptions = {}): Promise<number> {
  const stderr =
    options.stderr ??
    ((text: string) => {
      process.stderr.write(text);
    });
  try {
    const env = options.env ?? process.env;
    const policy = interactionPolicy(
      argv,
      env,
      options.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY)
    );
    const context: CliRuntime = {
      app: options.application ?? createLocalApplication(env.KONOGAME_SAVE_ROOT),
      interactive: policy.interactive,
      json: policy.json,
      prompts: options.prompts ?? terminalPrompts,
      stdout:
        options.stdout ??
        ((text: string) => {
          process.stdout.write(text);
        }),
      stderr
    };
    return await cliContext.run(context, async () => {
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
      // Bootstrap mode flags may precede a command; oclif owns command parsing.
      const leading: string[] = [];
      let args = [...argv];
      while (args.length && interactionFlags.includes(args[0]!)) leading.push(args.shift()!);
      if (args.length === 0) {
        if (policy.json) throw new Error("A command is required with --json");
        if (policy.interactive) {
          const selected = await context.prompts.select(
            "Choose a command",
            config.commandIDs.map((id) => ({ value: id, label: id.replaceAll(":", " ") }))
          );
          args = [...selected.split(":"), ...leading];
        }
      } else {
        const boundary = args.indexOf("--");
        args.splice(boundary < 0 ? args.length : boundary, 0, ...leading);
      }
      await run(args, config);
      return 0;
    });
  } catch (error) {
    if (error instanceof Cancelled) {
      stderr("Cancelled.\n");
      return 130;
    }
    stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2));
}
