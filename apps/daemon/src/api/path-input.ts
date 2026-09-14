import { isAbsolute } from "node:path";
import { Effect } from "effect";
import { ApiError } from "./route.ts";

export function requireAbsolutePath(path: string, field: string) {
  return isAbsolute(path)
    ? Effect.void
    : Effect.fail(ApiError.badRequest(`${field} must be an absolute path`));
}
