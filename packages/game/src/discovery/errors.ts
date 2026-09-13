import { Data } from "effect";

export class GameDiscoveryError extends Data.TaggedError("GameDiscoveryError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
