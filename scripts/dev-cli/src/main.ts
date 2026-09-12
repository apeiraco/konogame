#!/usr/bin/env node
import { NodeRuntime } from "@effect/platform-node";
import { CORE_VERSION } from "@konogame/infrastructure/contracts";
import { runAsync } from "@optique/run";
import { Cause, Effect, Logger, Runtime } from "effect";
import { executeDevCommand } from "./command.ts";
import { DEV_OUTPUT } from "./context.ts";
import { devParser } from "./parser/index.ts";

export { checkDocs } from "./docs/check.ts";
export { checkRelease } from "./release/check.ts";
export { loadMetadata, metadataSchema, parseMetadata } from "./release/metadata.ts";
export { notesForRelease, releaseNotes } from "./release/notes.ts";
export { syncRelease } from "./release/sync.ts";
export { setReleaseVersion } from "./release/version.ts";
export { repositoryRoot } from "./repository.ts";

class RunnerStop {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}

export function runDevCli(
  argv: string[],
  options: {
    stdout?: (text: string) => void;
    stderr?: (text: string) => void;
  } = {}
) {
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
  const write = (target: (text: string) => void) => (text: string) => {
    target(text.endsWith("\n") ? text : `${text}\n`);
  };
  return Effect.scoped(
    Effect.gen(function* () {
      const parsed = yield* Effect.promise(async () => {
        try {
          const value = await runAsync(devParser, {
            programName: "konogame-dev",
            args: argv,
            stdout: write(stdout),
            stderr: write(stderr),
            help: { option: { names: ["-h", "--help"] } },
            version: { value: CORE_VERSION, option: { names: ["-v", "--version"] } },
            completion: "both",
            onExit: (code): never => {
              throw new RunnerStop(code);
            }
          });
          return { stopped: false as const, value };
        } catch (error) {
          if (error instanceof RunnerStop) {
            return { stopped: true as const, code: error.code };
          }
          throw error;
        }
      });
      if (parsed.stopped) {
        return parsed.code;
      }
      yield* executeDevCommand(parsed.value);
      return 0;
    })
  ).pipe(
    Effect.provideService(Logger.LogToStderr, true),
    Effect.provideService(DEV_OUTPUT, { stdout, stderr }),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.sync(() => {
            stderr(
              `${String(Cause.squash(cause) instanceof Error ? (Cause.squash(cause) as Error).message : Cause.squash(cause))}\n`
            );
            return 1;
          })
    )
  );
}

if (import.meta.main) {
  NodeRuntime.runMain(runDevCli(process.argv.slice(2)), {
    teardown: (exit, onExit) =>
      exit._tag === "Success" && typeof exit.value === "number"
        ? onExit(exit.value)
        : Runtime.defaultTeardown(exit, onExit)
  });
}
