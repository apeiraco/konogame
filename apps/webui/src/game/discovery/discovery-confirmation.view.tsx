import { Button, Checkbox, Modal } from "@mantine/core";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { admissionSelectionSummary } from "./discovery.model.ts";
import { DispositionBadge } from "./discovery-candidates.view.tsx";
import { ConfirmationKind, DISCOVERY_REVIEW } from "./discovery-review.service.ts";

/** Step 3: the explicit write confirmation. The service ignores submit until it is checked. */
export function DiscoveryConfirmation({ workspaceRoot }: { readonly workspaceRoot: string }) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const discoveryReview = useWebUIService(DISCOVERY_REVIEW);
  const review = discoveryReview.state.value;
  const { confirmation, confirmed, preview, selection, result } = review;
  const pending = review.admissionPending;
  const selected = preview?.candidates.filter((item) => selection[item.candidateId]) ?? [];
  const plan = admissionSelectionSummary(preview?.candidates ?? [], selection);
  const recover = confirmation === ConfirmationKind.Recover;
  return (
    <Modal
      opened={confirmation !== undefined}
      onClose={() => discoveryReview.closeConfirmation()}
      title={recover ? t("discovery:confirmRecoveryTitle") : t("discovery:confirmAdmissionTitle")}
      centered
      size="lg"
      // A cancelled dialog returns focus to its trigger; a completed one hands it to the outcome.
      returnFocus={!review.closedBySubmission}
      closeButtonProps={{ "aria-label": t("discovery:closeDialog") }}
      closeOnClickOutside={!pending}
      closeOnEscape={!pending}
      withCloseButton={!pending}
      classNames={{ title: "kg-modal-title" }}
    >
      <div className="kg-confirm">
        <div className="kg-confirm-target">
          <span>{t("discovery:workspaceLabel")}</span>
          <code className="kg-mono">{workspaceRoot}</code>
        </div>
        {recover ? (
          <>
            <p>{t("discovery:recoveryOperation")}</p>
            <code className="kg-mono kg-confirm-code">{result?.operationId}</code>
            <p className="kg-hint">{t("discovery:recoveryScope")}</p>
          </>
        ) : (
          <>
            <dl className="kg-write-ledger">
              <div>
                <dt>{t("discovery:ledgerNewGameCandidates")}</dt>
                <dd>{plan.newGameCandidates}</dd>
              </div>
              <div>
                <dt>{t("discovery:ledgerReuseCandidates")}</dt>
                <dd>{plan.reuseGameCandidates}</dd>
              </div>
              <div>
                <dt>{t("discovery:ledgerExistingCandidates")}</dt>
                <dd>{plan.existingCandidates}</dd>
              </div>
            </dl>
            <p>{t("discovery:confirmSelection", { count: selected.length })}</p>
            <ul className="kg-confirm-list">
              {selected.map((item) => (
                <li key={item.candidateId}>
                  <span>{item.title}</span>
                  <DispositionBadge disposition={item.disposition} />
                </li>
              ))}
            </ul>
            <p className="kg-hint">{t("discovery:selectionNote")}</p>
            <p className="kg-hint">{t("discovery:admissionDescription")}</p>
          </>
        )}
        <Checkbox
          label={
            recover
              ? t("discovery:confirmRecoveryCheckbox")
              : t("discovery:confirmAdmissionCheckbox")
          }
          checked={confirmed}
          disabled={pending}
          onChange={(event) => discoveryReview.confirm(event.currentTarget.checked)}
        />
        <div className="kg-confirm-actions">
          <Button
            variant="default"
            disabled={pending}
            onClick={() => discoveryReview.closeConfirmation()}
          >
            {t("discovery:cancel")}
          </Button>
          <Button
            color={recover ? "orange" : undefined}
            disabled={!confirmed}
            loading={pending}
            onClick={() => void runUiEffect(discoveryReview.submit())}
          >
            {recover ? t("discovery:confirmRecovery") : t("discovery:confirmAdmission")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
