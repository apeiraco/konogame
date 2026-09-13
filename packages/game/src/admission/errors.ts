import { AdapterResolutionUnavailableError } from "@konogame/infrastructure";
import {
  type LocationComparisonStatus,
  SchemaValidationError
} from "@konogame/infrastructure/contracts";
import {
  isWorkspaceRuleFailure,
  type SourceStatus,
  type WorkspaceRuleFailure
} from "@konogame/workspace";
import { Data, Effect } from "effect";

export const GameDiscoveryInputKind = {
  DuplicateCandidates: "duplicate-candidates"
} as const;
export type GameDiscoveryInputKind =
  (typeof GameDiscoveryInputKind)[keyof typeof GameDiscoveryInputKind];
export class GameDiscoveryInputError extends Data.TaggedError("GameDiscoveryInputError")<{
  readonly issue: {
    readonly kind: typeof GameDiscoveryInputKind.DuplicateCandidates;
    readonly candidateIds: readonly string[];
  };
  readonly message: string;
  readonly operation?: string;
}> {}

export class GameDiscoveryNotFoundError extends Data.TaggedError("GameDiscoveryNotFoundError")<{
  readonly issue: { readonly kind: "candidate"; readonly id: string };
  readonly message: string;
  readonly operation?: string;
}> {}

export const AdmissionConflictKind = {
  IdentityIssuer: "identity-issuer",
  ObservationIdentity: "observation-identity",
  ObservationLocationIdentity: "observation-location-identity",
  LocationComparison: "location-comparison",
  LocationValidation: "location-validation",
  InstallationLocationChanged: "installation-location-changed",
  ExternalIdentity: "external-identity"
} as const;
export type AdmissionConflictKind =
  (typeof AdmissionConflictKind)[keyof typeof AdmissionConflictKind];
export interface AdmissionConflict {
  kind: AdmissionConflictKind;
  recordIds?: string[];
  issuer?: string;
}

export const GameDiscoveryConflictKind = {
  ObservationKey: "observation-key",
  Candidate: "candidate",
  LocationIdentity: "location-identity"
} as const;
export type GameDiscoveryConflictKind =
  (typeof GameDiscoveryConflictKind)[keyof typeof GameDiscoveryConflictKind];
export type GameDiscoveryConflictIssue =
  | {
      readonly kind: typeof GameDiscoveryConflictKind.ObservationKey;
      readonly observationKey: string;
      readonly hostId: string;
      readonly sourceId: string;
    }
  | {
      readonly kind: typeof GameDiscoveryConflictKind.Candidate;
      readonly candidateId: string;
      readonly hostId: string;
      readonly sourceId: string;
      readonly reason?: string;
      readonly conflict?: AdmissionConflict;
    }
  | {
      readonly kind: typeof GameDiscoveryConflictKind.LocationIdentity;
      readonly candidateId: string;
      readonly previousCandidateId: string;
      readonly hostId: string;
      readonly sourceId: string;
    };
export class GameDiscoveryConflictError extends Data.TaggedError("GameDiscoveryConflictError")<{
  readonly issue: GameDiscoveryConflictIssue;
  readonly message: string;
  readonly operation?: string;
}> {}

export const GameDiscoveryMismatchKind = {
  Root: "root",
  Host: "host",
  Source: "source",
  Digest: "digest",
  OperationId: "operation-id",
  Stale: "stale"
} as const;
export type GameDiscoveryMismatchKind =
  (typeof GameDiscoveryMismatchKind)[keyof typeof GameDiscoveryMismatchKind];
export interface GameDiscoveryReviewIssue {
  readonly reviewKind: "game-discovery";
  readonly kind: GameDiscoveryMismatchKind;
  readonly expected: string;
  readonly actual: string;
  readonly expectedRevision?: string;
  readonly actualRevision?: string;
}
export class GameDiscoveryReviewMismatchError extends Data.TaggedError(
  "GameDiscoveryReviewMismatchError"
)<{
  readonly issue: GameDiscoveryReviewIssue;
  readonly message: string;
  readonly operation?: string;
}> {}

export const GameDiscoveryUnavailableKind = {
  SourceNotConfigured: "source-not-configured",
  LocationComparison: "location-comparison"
} as const;
export type GameDiscoveryUnavailableKind =
  (typeof GameDiscoveryUnavailableKind)[keyof typeof GameDiscoveryUnavailableKind];
export type GameDiscoveryUnavailableIssue =
  | {
      readonly kind: typeof GameDiscoveryUnavailableKind.SourceNotConfigured;
      readonly hostId: string;
      readonly sourceId: string;
      readonly status: SourceStatus;
    }
  | {
      readonly kind: typeof GameDiscoveryUnavailableKind.LocationComparison;
      readonly candidateId: string;
      readonly previousCandidateId: string;
      readonly status: LocationComparisonStatus;
    };
export class GameDiscoveryUnavailableError extends Data.TaggedError(
  "GameDiscoveryUnavailableError"
)<{
  readonly issue: GameDiscoveryUnavailableIssue;
  readonly message: string;
  readonly operation?: string;
}> {}

export type GameAdmissionFailure =
  | WorkspaceRuleFailure
  | SchemaValidationError
  | AdapterResolutionUnavailableError
  | GameDiscoveryInputError
  | GameDiscoveryNotFoundError
  | GameDiscoveryConflictError
  | GameDiscoveryReviewMismatchError
  | GameDiscoveryUnavailableError;

export function admissionRule<A, Args extends readonly unknown[]>(
  operation: string,
  evaluate: (...values: Args) => A,
  ...values: Args
): Effect.Effect<A, GameAdmissionFailure> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(evaluate(...values));
    } catch (cause) {
      return cause instanceof AdapterResolutionUnavailableError ||
        cause instanceof GameDiscoveryInputError ||
        cause instanceof GameDiscoveryNotFoundError ||
        cause instanceof GameDiscoveryConflictError ||
        cause instanceof GameDiscoveryReviewMismatchError ||
        cause instanceof GameDiscoveryUnavailableError ||
        cause instanceof SchemaValidationError ||
        isWorkspaceRuleFailure(cause)
        ? Effect.fail(cause)
        : Effect.die(cause);
    }
  }).pipe(Effect.annotateLogs({ operation }));
}
