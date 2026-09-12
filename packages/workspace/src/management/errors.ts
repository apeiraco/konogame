import { AdapterResolutionUnavailableError } from "@konogame/infrastructure";
import { SchemaValidationError } from "@konogame/infrastructure/contracts";
import { Data, Effect } from "effect";
import { isWorkspaceRuleFailure, type WorkspaceRuleFailure } from "../model/errors.ts";

export const WorkspaceSelectionKind = {
  HostRequired: "host-required",
  InstallationHostMismatch: "installation-host-mismatch",
  InstallationGameMismatch: "installation-game-mismatch"
} as const;
export type WorkspaceSelectionKind =
  (typeof WorkspaceSelectionKind)[keyof typeof WorkspaceSelectionKind];
export type WorkspaceSelectionIssue =
  | { readonly kind: typeof WorkspaceSelectionKind.HostRequired; readonly sourceId: string }
  | {
      readonly kind: typeof WorkspaceSelectionKind.InstallationHostMismatch;
      readonly installationId: string;
      readonly expectedHostId: string;
      readonly selectedHostId?: string;
    }
  | {
      readonly kind: typeof WorkspaceSelectionKind.InstallationGameMismatch;
      readonly installationId: string;
      readonly expectedGameId: string;
      readonly selectedGameId?: string;
    };
export class WorkspaceSelectionError extends Data.TaggedError("WorkspaceSelectionError")<{
  readonly issue: WorkspaceSelectionIssue;
  readonly message: string;
  readonly operation?: string;
}> {}

export const WorkspaceMismatchKind = {
  Root: "root",
  Host: "host",
  Source: "source",
  Digest: "digest",
  OperationId: "operation-id",
  Stale: "stale"
} as const;
export type WorkspaceMismatchKind =
  (typeof WorkspaceMismatchKind)[keyof typeof WorkspaceMismatchKind];
export interface WorkspaceReviewIssue {
  readonly reviewKind: "workspace-edit";
  readonly kind: WorkspaceMismatchKind;
  readonly expected: string;
  readonly actual: string;
  readonly expectedRevision?: string;
  readonly actualRevision?: string;
}
export class WorkspaceReviewMismatchError extends Data.TaggedError("WorkspaceReviewMismatchError")<{
  readonly issue: WorkspaceReviewIssue;
  readonly message: string;
  readonly operation?: string;
}> {}

export type WorkspaceUseCaseFailure =
  | WorkspaceRuleFailure
  | SchemaValidationError
  | AdapterResolutionUnavailableError
  | WorkspaceSelectionError
  | WorkspaceReviewMismatchError;

export function workspaceRule<A, Args extends readonly unknown[]>(
  operation: string,
  evaluate: (...values: Args) => A,
  ...values: Args
): Effect.Effect<A, WorkspaceUseCaseFailure> {
  return Effect.suspend(() => {
    try {
      return Effect.succeed(evaluate(...values));
    } catch (cause) {
      return cause instanceof AdapterResolutionUnavailableError ||
        cause instanceof WorkspaceSelectionError ||
        cause instanceof WorkspaceReviewMismatchError ||
        cause instanceof SchemaValidationError ||
        isWorkspaceRuleFailure(cause)
        ? Effect.fail(cause)
        : Effect.die(cause);
    }
  }).pipe(Effect.annotateLogs({ operation }));
}
