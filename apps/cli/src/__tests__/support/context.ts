import { GAME_ADMISSION } from "@konogame/game/admission";
import { EXTENSION_CATALOG, FEATURE_PLAN, ID_SERVICE } from "@konogame/infrastructure";
import { SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import { CLI_CONTEXT, type CliContext, type CliServices, type Prompts } from "../../context.ts";

export interface TestCliContext {
  readonly context: CliContext;
  readonly stdout: string[];
  readonly stderr: string[];
}

export function testCliContext(
  options: {
    readonly interactive?: boolean;
    readonly json?: boolean;
    readonly text?: Prompts["text"];
    readonly select?: Prompts["select"];
    readonly confirm?: Prompts["confirm"];
  } = {}
): TestCliContext {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const context: CliContext = {
    interactive: options.interactive ?? false,
    json: options.json ?? true,
    prompts: {
      text: options.text ?? (() => unexpected("text")),
      select: options.select ?? (() => unexpected("select")),
      confirm: options.confirm ?? (() => unexpected("confirm"))
    },
    stdout: (text) =>
      Effect.sync(() => {
        stdout.push(text);
      }),
    stderr: (text) =>
      Effect.sync(() => {
        stderr.push(text);
      })
  };
  return { context, stdout, stderr };
}

function unexpected(kind: string) {
  return Effect.die(new Error(`Unexpected ${kind} prompt`));
}

export interface TestCliServices {
  readonly plan?: unknown;
  readonly catalog?: unknown;
  readonly workspace?: unknown;
  readonly admission?: unknown;
  readonly save?: unknown;
  readonly ids?: unknown;
}

// CliCommandEffect declares every CLI service, so tests stub the ones they do not exercise.
export function provideTestCli<A, E>(
  effect: Effect.Effect<A, E, CliServices>,
  context: CliContext,
  services: TestCliServices
) {
  return effect.pipe(
    Effect.provideService(CLI_CONTEXT, context),
    Effect.provideService(FEATURE_PLAN, (services.plan ?? {}) as never),
    Effect.provideService(EXTENSION_CATALOG, (services.catalog ?? {}) as never),
    Effect.provideService(WORKSPACE_MANAGEMENT, (services.workspace ?? {}) as never),
    Effect.provideService(GAME_ADMISSION, (services.admission ?? {}) as never),
    Effect.provideService(SAVE_STORE_WORKFLOW, (services.save ?? {}) as never),
    Effect.provideService(ID_SERVICE, (services.ids ?? {}) as never)
  );
}
