import { DiscoveryDisposition } from "@konogame/game/contracts";
import { ImportStatus } from "@konogame/workspace/contracts";
import { describe, expect, it } from "vitest";
import { ApiNetworkError } from "../../../infrastructure/http/daemon-http.ts";
import {
  admissionSelectionSummary,
  countDispositions,
  ReviewOutcome,
  ReviewPhase,
  reviewOutcome,
  reviewPhase
} from "../discovery.model.ts";
import { type GameDiscoveryPreview } from "../discovery.read-model.ts";
import { ConfirmationKind } from "../discovery-review.service.ts";

const candidates = [
  { candidateId: "new-a", disposition: DiscoveryDisposition.NewGame },
  { candidateId: "new-b", disposition: DiscoveryDisposition.NewGame },
  { candidateId: "reuse", disposition: DiscoveryDisposition.ReuseGame },
  { candidateId: "existing", disposition: DiscoveryDisposition.ExistingInstallation },
  { candidateId: "conflict", disposition: DiscoveryDisposition.Conflict }
];
// Phase and outcome only inspect presence, so an opaque synthetic preview is sufficient.
const preview = {} as GameDiscoveryPreview;

describe("discovery review summary", () => {
  it("counts every disposition including empty ones", () => {
    expect(countDispositions(candidates)).toEqual({
      [DiscoveryDisposition.NewGame]: 2,
      [DiscoveryDisposition.ReuseGame]: 1,
      [DiscoveryDisposition.ExistingInstallation]: 1,
      [DiscoveryDisposition.Conflict]: 1
    });
    expect(countDispositions([])[DiscoveryDisposition.Conflict]).toBe(0);
  });

  it("summarises selected candidates by disposition and never counts conflicts", () => {
    expect(
      admissionSelectionSummary(candidates, {
        "new-a": true,
        reuse: true,
        existing: true,
        conflict: true,
        unknown: true
      })
    ).toEqual({ selected: 3, newGameCandidates: 1, reuseGameCandidates: 1, existingCandidates: 1 });
    expect(admissionSelectionSummary(candidates, {})).toEqual({
      selected: 0,
      newGameCandidates: 0,
      reuseGameCandidates: 0,
      existingCandidates: 0
    });
  });

  it("reports candidates, not records, when new-game candidates may share one game", () => {
    // Admission may merge these two into one Game; the summary must not promise two records.
    const summary = admissionSelectionSummary(candidates, { "new-a": true, "new-b": true });
    expect(summary).toEqual({
      selected: 2,
      newGameCandidates: 2,
      reuseGameCandidates: 0,
      existingCandidates: 0
    });
    expect(Object.keys(summary)).not.toContain("newGames");
  });

  it("derives the visible review phase from service state", () => {
    expect(reviewPhase({})).toBe(ReviewPhase.Scope);
    expect(reviewPhase({ preview })).toBe(ReviewPhase.Review);
    expect(reviewPhase({ preview, confirmation: ConfirmationKind.Admit })).toBe(
      ReviewPhase.Confirm
    );
    expect(
      reviewPhase({ preview, result: { status: ImportStatus.Imported, operationId: "op" } })
    ).toBe(ReviewPhase.Result);
    expect(
      reviewPhase({
        preview,
        admissionError: new ApiNetworkError({ path: "/api/game-admissions", cause: "offline" })
      })
    ).toBe(ReviewPhase.Result);
  });

  it("offers recovery only for recovery-required results and treats other refusals as stale", () => {
    const outcome = (status: ImportStatus) =>
      reviewOutcome({ result: { status, operationId: "op" } });
    expect(reviewOutcome({})).toBeUndefined();
    expect(outcome(ImportStatus.Imported)).toBe(ReviewOutcome.Written);
    expect(outcome(ImportStatus.Unchanged)).toBe(ReviewOutcome.Unchanged);
    expect(outcome(ImportStatus.RecoveryRequired)).toBe(ReviewOutcome.Recovery);
    expect(outcome(ImportStatus.Conflict)).toBe(ReviewOutcome.Stale);
    expect(outcome(ImportStatus.Failed)).toBe(ReviewOutcome.Stale);
    expect(
      reviewOutcome({
        admissionError: new ApiNetworkError({ path: "/api/game-admissions", cause: "offline" })
      })
    ).toBe(ReviewOutcome.Stale);
  });
});
