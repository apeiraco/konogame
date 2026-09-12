import { Context, Data, Effect } from "effect";

export class DevCliError extends Data.TaggedError("DevCliError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static from(cause: unknown): DevCliError {
    return cause instanceof DevCliError
      ? cause
      : new DevCliError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause
        });
  }
}

export const checked = <A>(evaluate: () => A) =>
  Effect.try({ try: evaluate, catch: DevCliError.from });
export const external = <A>(evaluate: () => Promise<A>) =>
  Effect.tryPromise({ try: evaluate, catch: DevCliError.from });

export class DEV_OUTPUT extends Context.Service<
  DEV_OUTPUT,
  {
    readonly stdout: (text: string) => void;
    readonly stderr: (text: string) => void;
  }
>()("dev-cli.output") {}

export type DevServices = DEV_OUTPUT;

export function output(value: unknown) {
  return Effect.gen(function* () {
    const { stdout } = yield* DEV_OUTPUT;
    yield* Effect.sync(() =>
      stdout(`${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n`)
    );
  });
}
