import { UnexpectedBoundaryError } from "@konogame/infrastructure/contracts";
import {
  type ConfigurationInputIssue,
  ConfigurationInputKind,
  type ConfigurationInvalidInputFailure,
  isWorkspaceRuleFailure,
  type WorkspaceRuleFailure
} from "@konogame/workspace";
import { Data, Effect } from "effect";

export class ConfigurationInvalidInputError
  extends Data.TaggedError("ConfigurationInvalidInputError")<{
    readonly issue: ConfigurationInputIssue;
    readonly message: string;
  }>
  implements ConfigurationInvalidInputFailure
{
  static make(issue: ConfigurationInputIssue, message: string): ConfigurationInvalidInputError {
    return new ConfigurationInvalidInputError({ issue, message });
  }
}
export type ConfigurationRuleFailure =
  | WorkspaceRuleFailure
  | ConfigurationInvalidInputError
  | UnexpectedBoundaryError;
export const isConfigurationRuleFailure = (error: unknown): error is ConfigurationRuleFailure =>
  isWorkspaceRuleFailure(error) ||
  error instanceof ConfigurationInvalidInputError ||
  error instanceof UnexpectedBoundaryError;

// Only known synchronous rejections enter the typed channel. Programming failures remain defects.
export function configurationRule<A, Args extends readonly unknown[]>(
  operation: string,
  evaluate: (...values: Args) => A,
  ...values: Args
): Effect.Effect<A, ConfigurationRuleFailure> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(evaluate(...values));
    } catch (error) {
      return isConfigurationRuleFailure(error) ? Effect.fail(error) : Effect.die(error);
    }
  }).pipe(Effect.annotateLogs({ operation }));
}

export function parseConfigurationJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw ConfigurationInvalidInputError.make(
        { kind: ConfigurationInputKind.Syntax, format: "json" },
        error.message
      );
    }
    throw new UnexpectedBoundaryError({
      boundary: "configuration.json-parser",
      message: error instanceof Error ? error.message : String(error),
      cause: error
    });
  }
}

export function decodeConfigurationText(bytes: Uint8Array, path?: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (
      error instanceof TypeError &&
      "code" in error &&
      error.code === "ERR_ENCODING_INVALID_ENCODED_DATA"
    ) {
      throw ConfigurationInvalidInputError.make(
        { kind: ConfigurationInputKind.Utf8, ...(path ? { path } : {}) },
        error.message
      );
    }
    throw error;
  }
}
