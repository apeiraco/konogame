import { Button } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { RawDetails } from "../../infrastructure/components/raw-details.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { ReviewOutcome, reviewOutcome } from "./discovery.model.ts";
import { ConfirmationKind, DISCOVERY_REVIEW } from "./discovery-review.service.ts";

const outcomeTitleKeys = {
  [ReviewOutcome.Written]: "discovery:importedTitle",
  [ReviewOutcome.Unchanged]: "discovery:unchangedTitle",
  [ReviewOutcome.Recovery]: "discovery:recoveryTitle",
  [ReviewOutcome.Stale]: "discovery:staleTitle"
} as const;
const outcomeTones = {
  [ReviewOutcome.Written]: "success",
  [ReviewOutcome.Unchanged]: "neutral",
  [ReviewOutcome.Recovery]: "warning",
  [ReviewOutcome.Stale]: "warning"
} as const;

/** Step 4: what the daemon reported, and the one next action that applies to it. */
export function DiscoveryOutcome() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const discoveryReview = useWebUIService(DISCOVERY_REVIEW);
  const review = discoveryReview.state.value;
  const outcome = reviewOutcome(review);
  const heading = useRef<HTMLHeadingElement>(null);
  const completedBySubmission = review.closedBySubmission;
  const { result: completedResult, admissionError: completedError } = review;

  useEffect(() => {
    // Each completed submission, including a recovery of the same operation, hands focus to the
    // new outcome. Cancelling a dialog leaves the outcome alone so focus returns to its trigger.
    if (completedBySubmission && (completedResult || completedError !== undefined)) {
      heading.current?.focus();
    }
  }, [completedBySubmission, completedResult, completedError]);

  if (!outcome) {
    return null;
  }
  const { result } = review;
  const busy = review.previewPending || review.admissionPending;
  return (
    <section
      className="kg-panel kg-outcome"
      data-tone={outcomeTones[outcome]}
      aria-labelledby="outcome-title"
      role="status"
    >
      <div className="kg-panel-head">
        <span className="kg-step-index" aria-hidden="true">
          4
        </span>
        <div>
          <h2 id="outcome-title" ref={heading} tabIndex={-1} className="kg-section-title">
            {t(outcomeTitleKeys[outcome])}
          </h2>
          {outcome === ReviewOutcome.Written && (
            <p>
              {t("discovery:importedSummary", {
                games: result?.gameIds?.length ?? 0,
                installations: result?.installationIds?.length ?? 0
              })}
            </p>
          )}
          {outcome === ReviewOutcome.Unchanged && <p>{t("discovery:unchangedDescription")}</p>}
          {outcome === ReviewOutcome.Recovery && <p>{t("discovery:recoveryDescription")}</p>}
          {outcome === ReviewOutcome.Stale && <p>{t("discovery:staleDescription")}</p>}
        </div>
      </div>
      {result?.reason && <p className="kg-outcome-reason">{result.reason}</p>}
      {review.admissionError !== undefined && <ErrorNotice error={review.admissionError} />}
      <div className="kg-outcome-actions">
        {outcome === ReviewOutcome.Recovery ? (
          <Button
            color="orange"
            onClick={() => discoveryReview.openConfirmation(ConfirmationKind.Recover)}
          >
            {t("discovery:reviewRecovery")}
          </Button>
        ) : (
          <>
            {outcome !== ReviewOutcome.Stale && (
              <Button component={Link} to="/">
                {t("discovery:viewWall")}
              </Button>
            )}
            <Button
              variant={outcome === ReviewOutcome.Stale ? "filled" : "default"}
              loading={review.previewPending}
              disabled={busy}
              onClick={() => void runUiEffect(discoveryReview.preview())}
            >
              {t("discovery:previewAgain")}
            </Button>
          </>
        )}
      </div>
      {result && (
        <>
          <p className="kg-id-line kg-mono">
            {t("discovery:operationId", { id: result.operationId })}
          </p>
          <RawDetails label={t("discovery:importDetails")} value={result} />
        </>
      )}
    </section>
  );
}
