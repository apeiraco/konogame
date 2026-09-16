import { useQuery } from "@tanstack/react-query";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { workspaceKeys } from "../../workspace/workspace.query-keys.ts";
import { WORKSPACE_QUERY } from "../../workspace/workspace-query.service.ts";
import { WORKSPACE_SESSION } from "../../workspace/workspace-session.service.ts";
import { WorkspaceWelcome } from "../../workspace/workspace-welcome.view.tsx";
import { ReviewPhase, reviewPhase, reviewPhases } from "./discovery.model.ts";
import { DiscoveryCandidates } from "./discovery-candidates.view.tsx";
import { DiscoveryConfirmation } from "./discovery-confirmation.view.tsx";
import { DiscoveryOutcome } from "./discovery-outcome.view.tsx";
import { DISCOVERY_REVIEW } from "./discovery-review.service.ts";
import { DiscoveryScopeForm } from "./discovery-scope.view.tsx";

const phaseMessageKeys = {
  [ReviewPhase.Scope]: "discovery:phaseScope",
  [ReviewPhase.Review]: "discovery:phaseReview",
  [ReviewPhase.Confirm]: "discovery:phaseConfirm",
  [ReviewPhase.Result]: "discovery:phaseResult"
} as const;

export function DiscoveryPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const session = useWebUIService(WORKSPACE_SESSION);
  const discoveryReview = useWebUIService(DISCOVERY_REVIEW);
  const workspace = useWebUIService(WORKSPACE_QUERY);
  const workspaceRoot = session.workspaceRoot.value;
  const configurationAdapterId = session.configurationAdapterId.value;
  const review = discoveryReview.state.value;
  const inspection = useQuery({
    queryKey: workspaceKeys.inspection(workspaceRoot, configurationAdapterId),
    queryFn: ({ signal }) =>
      runUiEffect(workspace.inspect(workspaceRoot, configurationAdapterId), signal),
    enabled: !!workspaceRoot
  });
  if (!workspaceRoot) {
    return <WorkspaceWelcome />;
  }
  const { preview } = review;
  const phase = reviewPhase(review);
  const phaseIndex = reviewPhases.indexOf(phase);
  const hostLabel =
    inspection.data?.hosts.find((item) => item.id === (preview?.hostId ?? review.form.hostId))
      ?.label ?? "";
  return (
    <section className="kg-page" aria-labelledby="discovery-title">
      <header className="kg-page-head">
        <div>
          <p className="kg-eyebrow">{t("discovery:eyebrow")}</p>
          <h1 id="discovery-title" className="kg-display">
            {t("discovery:title")}
          </h1>
          <p className="kg-lede">{t("discovery:introduction")}</p>
        </div>
      </header>
      <ol className="kg-steps" aria-label={t("discovery:progress")}>
        {reviewPhases.map((item, index) => (
          <li
            key={item}
            data-state={index < phaseIndex ? "done" : index === phaseIndex ? "current" : "next"}
            aria-current={index === phaseIndex ? "step" : undefined}
          >
            <span className="kg-steps-index" aria-hidden="true">
              {index + 1}
            </span>
            {t(phaseMessageKeys[item])}
          </li>
        ))}
      </ol>
      <div className="kg-discovery">
        <DiscoveryScopeForm
          inspection={inspection.data}
          inspectionError={inspection.isError ? inspection.error : undefined}
          inspectionPending={inspection.isPending}
          retryInspection={() => void inspection.refetch()}
        />
        <div className="kg-discovery-main">
          <DiscoveryOutcome />
          {review.previewError !== undefined && <ErrorNotice error={review.previewError} />}
          {review.previewPending && (
            <div className="kg-panel kg-scanning" role="status">
              <span className="kg-scan-bar" aria-hidden="true" />
              <p>{t("discovery:scanning")}</p>
            </div>
          )}
          {preview ? (
            <DiscoveryCandidates preview={preview} hostLabel={hostLabel} />
          ) : (
            !review.previewPending &&
            phase === ReviewPhase.Scope && (
              <div className="kg-panel kg-review-placeholder">
                <h2 className="kg-section-title">{t("discovery:placeholderTitle")}</h2>
                <ol className="kg-placeholder-steps">
                  <li>{t("discovery:placeholderStepScope")}</li>
                  <li>{t("discovery:placeholderStepReview")}</li>
                  <li>{t("discovery:placeholderStepConfirm")}</li>
                </ol>
              </div>
            )
          )}
        </div>
      </div>
      <DiscoveryConfirmation workspaceRoot={workspaceRoot} />
    </section>
  );
}
