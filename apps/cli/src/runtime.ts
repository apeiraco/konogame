import { AsyncLocalStorage } from "node:async_hooks";
import * as clack from "@clack/prompts";
import { type KonogameApplication } from "@konogame/application";

export class Cancelled extends Error {}

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
  text(message: string): Promise<string>;
  select(message: string, options: { value: string; label: string }[]): Promise<string>;
  confirm(message: string): Promise<boolean>;
}

function uncancel<T>(value: T | symbol): T {
  if (clack.isCancel(value)) throw new Cancelled("Cancelled");
  return value as T;
}

export const terminalPrompts: Prompts = {
  async text(message) {
    return uncancel<string>(
      await clack.text({
        message,
        output: process.stderr,
        validate: (value) => (value?.trim() ? undefined : "A value is required")
      })
    );
  },
  async select(message, options) {
    return uncancel<string>(await clack.select({ message, options, output: process.stderr }));
  },
  async confirm(message) {
    return uncancel<boolean>(
      await clack.confirm({ message, initialValue: false, output: process.stderr })
    );
  }
};

export interface CliRuntime {
  app: KonogameApplication;
  interactive: boolean;
  json: boolean;
  prompts: Prompts;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

export const cliContext = new AsyncLocalStorage<CliRuntime>();

export function runtime(): CliRuntime {
  const value = cliContext.getStore();
  if (!value) throw new Error("CLI command requires an active runtime");
  return value;
}

export async function required(value: string | undefined, name: string): Promise<string> {
  if (value !== undefined) return value;
  const context = runtime();
  if (!context.interactive) throw new Error(`Missing required argument: ${name}`);
  return context.prompts.text(name);
}

export function output(value: unknown): void {
  runtime().stdout(`${JSON.stringify(value, null, 2)}\n`);
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
        throw new Error("Conflicting interactive flags");
      explicit = enabled;
    } else if (!positional && arg === InteractionFlag.Json) json = true;
  }
  const environment =
    env.INTERACTIVE === undefined ? undefined : env.INTERACTIVE.toLowerCase() !== "false";
  return { json, interactive: !json && tty && (explicit ?? environment ?? true) };
}
