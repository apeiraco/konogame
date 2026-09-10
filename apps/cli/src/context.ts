import * as clack from "@clack/prompts";
import { type GAME_ADMISSION } from "@konogame/game/admission";
import {
  type EXTENSION_CATALOG,
  type FEATURE_PLAN,
  type ID_SERVICE
} from "@konogame/infrastructure";
import { type SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { type WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Context, Data, Effect } from "effect";

export class Cancelled extends Data.TaggedError("Cancelled")<{ readonly message: string }> {
  constructor(message = "Cancelled") {
    super({ message });
  }
}
export class CliError extends Data.TaggedError("CliError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static from(cause: unknown): CliError | Cancelled {
    return cause instanceof CliError || cause instanceof Cancelled
      ? cause
      : new CliError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause
        });
  }
}
export const cliExternal = <A>(evaluate: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: CliError.from });
export const cliChecked = <Args extends unknown[], A>(
  evaluate: (...args: Args) => A,
  ...args: Args
) => Effect.try({ try: () => evaluate(...args), catch: CliError.from });

export const InteractionFlag = {
  Enable: "--interactive",
  EnableExplicit: "--interactive=true",
  Disable: "--interactive=false",
  NonInteractive: "--non-interactive",
  Json: "--json"
} as const;
export type InteractionFlag = (typeof InteractionFlag)[keyof typeof InteractionFlag];
export const interactionFlags: readonly string[] = Object.values(InteractionFlag);

export interface Prompts {
  text(message: string): Effect.Effect<string, CliError | Cancelled>;
  select(
    message: string,
    options: { value: string; label: string }[]
  ): Effect.Effect<string, CliError | Cancelled>;
  confirm(message: string): Effect.Effect<boolean, CliError | Cancelled>;
}
function uncancel<T>(value: T | symbol) {
  return clack.isCancel(value) ? Effect.fail(new Cancelled()) : Effect.succeed(value as T);
}
export const terminalPrompts: Prompts = {
  text: (message) =>
    cliExternal((signal) =>
      clack.text({
        signal,
        message,
        output: process.stderr,
        validate: (value) => (value?.trim() ? undefined : "A value is required")
      })
    ).pipe(Effect.flatMap(uncancel<string>)),
  select: (message, options) =>
    cliExternal((signal) =>
      clack.select({ signal, message, options, output: process.stderr })
    ).pipe(Effect.flatMap(uncancel<string>)),
  confirm: (message) =>
    cliExternal((signal) =>
      clack.confirm({ signal, message, initialValue: false, output: process.stderr })
    ).pipe(Effect.flatMap(uncancel<boolean>))
};

export class CLI_PROMPTS extends Context.Service<CLI_PROMPTS, Prompts>()("cli.prompts") {}

export interface CliContext {
  readonly interactive: boolean;
  readonly json: boolean;
  readonly prompts: Prompts;
  readonly stdout: (text: string) => Effect.Effect<void>;
  readonly stderr: (text: string) => Effect.Effect<void>;
}
export class CLI_CONTEXT extends Context.Service<CLI_CONTEXT, CliContext>()("cli.io") {}
export type CliServices =
  | CLI_CONTEXT
  | FEATURE_PLAN
  | EXTENSION_CATALOG
  | WORKSPACE_MANAGEMENT
  | GAME_ADMISSION
  | SAVE_STORE_WORKFLOW
  | ID_SERVICE;
export type CliCommandEffect = Effect.Effect<void, unknown, CliServices>;

export function required(value: string | undefined, name: string) {
  return Effect.gen(function* () {
    if (value !== undefined) return value;
    const context = yield* CLI_CONTEXT;
    if (!context.interactive)
      return yield* Effect.fail(new CliError({ message: `Missing required argument: ${name}` }));
    return yield* context.prompts.text(name);
  });
}
export function output(value: unknown) {
  return Effect.gen(function* () {
    const context = yield* CLI_CONTEXT;
    yield* context.stdout(`${JSON.stringify(value, null, 2)}\n`);
  });
}

export function interactionPolicy(args: readonly string[], env: NodeJS.ProcessEnv, tty: boolean) {
  let explicit: boolean | undefined;
  let json = false;
  let positional = false;
  for (const arg of args) {
    if (arg === "--") positional = true;
    if (!positional && interactionFlags.includes(arg) && arg !== InteractionFlag.Json) {
      const enabled = arg === InteractionFlag.Enable || arg === InteractionFlag.EnableExplicit;
      if (explicit !== undefined && explicit !== enabled)
        throw new CliError({ message: "Conflicting interactive flags" });
      explicit = enabled;
    } else if (!positional && arg === InteractionFlag.Json) json = true;
  }
  const environment =
    env.INTERACTIVE === undefined ? undefined : env.INTERACTIVE.toLowerCase() !== "false";
  return { json, interactive: !json && tty && (explicit ?? environment ?? true) };
}
