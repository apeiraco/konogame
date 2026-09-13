import { Data } from "effect";

export class SaveError extends Data.TaggedError("SaveError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
