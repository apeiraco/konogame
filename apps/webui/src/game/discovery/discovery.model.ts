import { type AdmissionCandidate } from "@konogame/game/admission";
import { DiscoveryDisposition } from "@konogame/game/contracts";
import { ImportStatus } from "@konogame/workspace/contracts";
import { type DiscoveryReviewState } from "./discovery-review.service.ts";

type CandidateDisposition = Pick<AdmissionCandidate, "candidateId" | "disposition">;

export function canSelectCandidate(candidate: Pick<AdmissionCandidate, "disposition">) {
  return candidate.disposition !== DiscoveryDisposition.Conflict;
}

export type DispositionCounts = Readonly<Record<DiscoveryDisposition, number>>;

export function countDispositions(candidates: readonly CandidateDisposition[]): DispositionCounts {
  const counts: Record<DiscoveryDisposition, number> = {
    [DiscoveryDisposition.NewGame]: 0,
    [DiscoveryDisposition.ReuseGame]: 0,
    [DiscoveryDisposition.ExistingInstallation]: 0,
    [DiscoveryDisposition.Conflict]: 0
  };
  for (const candidate of candidates) {
    counts[candidate.disposition] += 1;
  }
  return counts;
}

/**
 * Selected candidates by preview disposition. These are candidate counts, not record counts:
 * admission merges candidates sharing a game identity and writes an equivalent Location once,
 * using Location comparisons only the daemon can perform. The written result reports records.
 */
export interface AdmissionSelectionSummary {
  readonly selected: number;
  readonly newGameCandidates: number;
  readonly reuseGameCandidates: number;
  readonly existingCandidates: number;
}

export function admissionSelectionSummary(
  candidates: readonly CandidateDisposition[],
  selection: Readonly<Record<string, boolean>>
): AdmissionSelectionSummary {
  const counts = countDispositions(
    candidates.filter((item) => selection[item.candidateId] && canSelectCandidate(item))
  );
  return {
    selected:
      counts[DiscoveryDisposition.NewGame] +
      counts[DiscoveryDisposition.ReuseGame] +
      counts[DiscoveryDisposition.ExistingInstallation],
    newGameCandidates: counts[DiscoveryDisposition.NewGame],
    reuseGameCandidates: counts[DiscoveryDisposition.ReuseGame],
    existingCandidates: counts[DiscoveryDisposition.ExistingInstallation]
  };
}

/** Where the reviewer is in the scope → review → confirm → result path. */
export const ReviewPhase = {
  Scope: "scope",
  Review: "review",
  Confirm: "confirm",
  Result: "result"
} as const;
export type ReviewPhase = (typeof ReviewPhase)[keyof typeof ReviewPhase];

export const reviewPhases = [
  ReviewPhase.Scope,
  ReviewPhase.Review,
  ReviewPhase.Confirm,
  ReviewPhase.Result
] as const;

export function reviewPhase(
  state: Pick<DiscoveryReviewState, "preview" | "confirmation" | "result" | "admissionError">
): ReviewPhase {
  if (state.confirmation) {
    return ReviewPhase.Confirm;
  }
  if (state.result || state.admissionError !== undefined) {
    return ReviewPhase.Result;
  }
  return state.preview ? ReviewPhase.Review : ReviewPhase.Scope;
}

/** Outcome presentation; only a recovery-required result offers the recovery operation. */
export const ReviewOutcome = {
  Written: "written",
  Unchanged: "unchanged",
  Recovery: "recovery",
  Stale: "stale"
} as const;
export type ReviewOutcome = (typeof ReviewOutcome)[keyof typeof ReviewOutcome];

export function reviewOutcome(
  state: Pick<DiscoveryReviewState, "result" | "admissionError">
): ReviewOutcome | undefined {
  if (state.result?.status === ImportStatus.Imported) {
    return ReviewOutcome.Written;
  }
  if (state.result?.status === ImportStatus.Unchanged) {
    return ReviewOutcome.Unchanged;
  }
  if (state.result?.status === ImportStatus.RecoveryRequired) {
    return ReviewOutcome.Recovery;
  }
  return state.result || state.admissionError !== undefined ? ReviewOutcome.Stale : undefined;
}
