import { ImportStatus, SourceStatus } from "@konogame/workspace/contracts";
import { Button, JsonInput, NumberInput, Select, Switch, Textarea } from "@mantine/core";
import { type FormEvent } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { type WorkspaceInspection } from "../../workspace/workspace.read-model.ts";
import { DISCOVERY_REVIEW, DiscoveryFormErrorCode } from "./discovery-review.service.ts";

const formErrorMessages = {
  [DiscoveryFormErrorCode.InvalidJson]: "discovery:formInvalidJson",
  [DiscoveryFormErrorCode.ScopeObjectRequired]: "discovery:formScopeObject",
  [DiscoveryFormErrorCode.PathsRequired]: "discovery:formPathsRequired"
} as const;

/** Step 1: the explicit scan scope. Editing it discards any earlier preview in the service. */
export function DiscoveryScopeForm({
  inspection,
  inspectionError,
  inspectionPending,
  retryInspection
}: {
  readonly inspection: WorkspaceInspection | undefined;
  readonly inspectionError: unknown;
  readonly inspectionPending: boolean;
  readonly retryInspection: () => void;
}) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const discoveryReview = useWebUIService(DISCOVERY_REVIEW);
  const review = discoveryReview.state.value;
  const { hostId, sourceId, paths, depth, exclude, advanced, scopeJson } = review.form;
  const busy = review.previewPending || review.admissionPending;
  const locked = busy || review.result?.status === ImportStatus.RecoveryRequired;
  const host = inspection?.hosts.find((item) => item.id === hostId);
  const source = host?.sources.find((item) => item.id === sourceId);
  const ready = !!host && source?.status === SourceStatus.Configured && !locked;
  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready) {
      void runUiEffect(discoveryReview.preview());
    }
  }
  return (
    <form className="kg-panel kg-scope" onSubmit={submit} aria-labelledby="scope-title">
      <div className="kg-panel-head">
        <span className="kg-step-index" aria-hidden="true">
          1
        </span>
        <div>
          <h2 id="scope-title" className="kg-section-title">
            {t("discovery:scopeTitle")}
          </h2>
          <p className="kg-hint">{t("discovery:scopeIntro")}</p>
        </div>
      </div>
      {inspectionPending && (
        <p className="kg-hint" role="status">
          {t("discovery:loadingSources")}
        </p>
      )}
      {inspectionError !== null && inspectionError !== undefined && (
        <ErrorNotice error={inspectionError} retry={retryInspection} />
      )}
      {inspection && !inspection.hosts.length && (
        <div className="kg-notice" data-tone="warning">
          <div className="kg-notice-body">
            <p className="kg-notice-title">{t("discovery:noHostsTitle")}</p>
            <p>{t("discovery:noHostsDescription")}</p>
          </div>
        </div>
      )}
      <Select
        label={t("discovery:hostLabel")}
        placeholder={t("discovery:hostPlaceholder")}
        data={(inspection?.hosts ?? []).map((item) => ({ value: item.id, label: item.label }))}
        value={hostId || null}
        disabled={locked || !inspection?.hosts.length}
        onChange={(value) => discoveryReview.updateForm({ hostId: value ?? "" })}
      />
      <Select
        label={t("discovery:sourceLabel")}
        placeholder={t("discovery:sourcePlaceholder")}
        description={host && !host.sources.length ? t("discovery:noSources") : undefined}
        data={(host?.sources ?? []).map((item) => ({
          value: item.id,
          label: t(
            item.status === SourceStatus.Configured
              ? "discovery:sourceOption"
              : "discovery:sourceOptionUnconfigured",
            { id: item.id, kind: item.kind }
          ),
          disabled: item.status !== SourceStatus.Configured
        }))}
        value={sourceId || null}
        disabled={!host || locked}
        onChange={(value) => discoveryReview.updateForm({ sourceId: value ?? "" })}
      />
      {host && <p className="kg-hint">{t("discovery:rootsHint")}</p>}
      {advanced ? (
        <JsonInput
          label={t("discovery:scopeLabel")}
          description={t("discovery:scopeDescription")}
          validationError={t("discovery:formInvalidJson")}
          value={scopeJson}
          classNames={{ input: "kg-mono" }}
          onChange={(value) => discoveryReview.updateForm({ scopeJson: value })}
          minRows={6}
          autosize
          disabled={locked}
        />
      ) : (
        <>
          <Textarea
            label={t("discovery:pathsLabel")}
            placeholder={t("discovery:pathsPlaceholder")}
            description={t("discovery:pathsDescription")}
            value={paths}
            classNames={{ input: "kg-mono" }}
            spellCheck={false}
            onChange={(event) => discoveryReview.updateForm({ paths: event.currentTarget.value })}
            minRows={3}
            autosize
            disabled={locked}
          />
          <div className="kg-field-row">
            <NumberInput
              label={t("discovery:depthLabel")}
              description={t("discovery:depthDescription")}
              min={0}
              max={16}
              allowDecimal={false}
              value={depth}
              onChange={(value) => discoveryReview.updateForm({ depth: value })}
              disabled={locked}
            />
            <Textarea
              label={t("discovery:excludeLabel")}
              placeholder={t("discovery:excludePlaceholder")}
              value={exclude}
              classNames={{ input: "kg-mono" }}
              spellCheck={false}
              autosize
              minRows={1}
              onChange={(event) =>
                discoveryReview.updateForm({ exclude: event.currentTarget.value })
              }
              disabled={locked}
            />
          </div>
        </>
      )}
      <Switch
        label={t("discovery:advancedLabel")}
        checked={advanced}
        disabled={locked}
        onChange={(event) => discoveryReview.updateForm({ advanced: event.currentTarget.checked })}
      />
      {review.formError && (
        <p className="kg-field-error" role="alert">
          {t(formErrorMessages[review.formError.code], { ...review.formError.params })}
        </p>
      )}
      <Button type="submit" loading={review.previewPending} disabled={!ready} fullWidth>
        {t("discovery:generatePreview")}
      </Button>
      <p className="kg-hint kg-readonly-note">{t("discovery:previewReadOnly")}</p>
    </form>
  );
}
