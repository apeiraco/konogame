import { type ArkError, ArkErrors } from "arktype";
import { Data } from "effect";

export interface SchemaValidationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly rule: string;
  readonly children?: readonly SchemaValidationIssue[];
}

export class SchemaValidationError extends Data.TaggedError("SchemaValidationError")<{
  readonly schemaId: string;
  readonly issues: readonly SchemaValidationIssue[];
  readonly message: string;
}> {}

export class UnexpectedBoundaryError extends Data.TaggedError("UnexpectedBoundaryError")<{
  readonly boundary: string;
  readonly message: string;
  readonly cause: unknown;
}> {}

function schemaIssue(issue: ArkError): SchemaValidationIssue {
  return {
    path: Array.from(issue.path, (part) => (typeof part === "number" ? part : String(part))),
    message: issue.message,
    rule: issue.code,
    ...(issue.hasCode("union") || issue.hasCode("intersection")
      ? { children: issue.errors.map(schemaIssue) }
      : {})
  };
}

// Built-in schemas stay pure; unexpected evaluator exceptions retain their defect semantics.
export function assertSchema<A>(
  schemaId: string,
  schema: (input: unknown) => A | ArkErrors,
  input: unknown
): A {
  const result = schema(input);
  if (result instanceof ArkErrors) {
    throw new SchemaValidationError({
      schemaId,
      message: result.summary,
      issues: result.map(schemaIssue)
    });
  }
  return result;
}

export const isSchemaValidationError = (error: unknown): error is SchemaValidationError =>
  error instanceof SchemaValidationError;
