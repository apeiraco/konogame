import { Data, Effect } from "effect";

export const AdapterResolutionUnavailableKind = {
  Resolution: "resolution",
  Implementation: "implementation",
  Operation: "operation"
} as const;
export type AdapterResolutionUnavailableKind =
  (typeof AdapterResolutionUnavailableKind)[keyof typeof AdapterResolutionUnavailableKind];
export type AdapterResolutionUnavailableIssue =
  | {
      readonly kind: typeof AdapterResolutionUnavailableKind.Resolution;
      readonly featureId: string;
      readonly reason?: string;
    }
  | {
      readonly kind: typeof AdapterResolutionUnavailableKind.Implementation;
      readonly featureId: string;
      readonly adapterId: string;
      readonly operation: string;
    }
  | {
      readonly kind: typeof AdapterResolutionUnavailableKind.Operation;
      readonly featureId: string;
      readonly adapterId: string;
      readonly operation: string;
    };
export class AdapterResolutionUnavailableError extends Data.TaggedError(
  "AdapterResolutionUnavailableError"
)<{
  readonly issue: AdapterResolutionUnavailableIssue;
  readonly message: string;
  readonly operation?: string;
}> {}

export class FeatureNotFoundError extends Data.TaggedError("FeatureNotFoundError")<{
  readonly issue: { readonly kind: "feature"; readonly id: string };
  readonly message: string;
  readonly operation?: string;
}> {}

export class ExtensionNotFoundError extends Data.TaggedError("ExtensionNotFoundError")<{
  readonly issue: { readonly kind: "extension"; readonly id: string };
  readonly message: string;
  readonly operation?: string;
}> {}

// Known rule refusals retain their owner tags; unknown trusted-code exceptions are defects.
export function infrastructureRule<A, Args extends readonly unknown[]>(
  operation: string,
  evaluate: (...values: Args) => A,
  ...values: Args
): Effect.Effect<A, FeatureNotFoundError> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(evaluate(...values));
    } catch (cause) {
      return cause instanceof FeatureNotFoundError ? Effect.fail(cause) : Effect.die(cause);
    }
  }).pipe(Effect.annotateLogs({ operation }));
}
