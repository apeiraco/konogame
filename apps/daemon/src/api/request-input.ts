import { assertSchema, SchemaValidationError } from "@konogame/infrastructure/contracts";
import { type ArkErrors } from "arktype";
import { Effect } from "effect";
import { ApiError } from "./route.ts";

export function validateApiInput<T>(
  schema: (input: unknown) => T | ArkErrors,
  value: unknown
): Effect.Effect<T, SchemaValidationError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(assertSchema("daemon.request", schema, value));
    } catch (error) {
      return error instanceof SchemaValidationError ? Effect.fail(error) : Effect.die(error);
    }
  });
}

export function readApiQuery(query: URLSearchParams) {
  const entries: Record<string, string> = {};
  for (const [key, value] of query) {
    if (Object.hasOwn(entries, key)) {
      return Effect.fail(ApiError.badRequest(`Query parameter ${key} must occur once`));
    }
    Object.defineProperty(entries, key, { enumerable: true, value });
  }
  return Effect.succeed(entries);
}
