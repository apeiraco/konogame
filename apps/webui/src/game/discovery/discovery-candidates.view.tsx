import { type AdmissionCandidate } from "@konogame/game/admission";
import { DiscoveryDisposition } from "@konogame/game/contracts";
import { LocationValidationStatus } from "@konogame/infrastructure/contracts";
import { ImportStatus } from "@konogame/workspace/contracts";
import { Button, Checkbox } from "@mantine/core";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Row,
  useReactTable
} from "@tanstack/react-table";
import { useState } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { RawDetails } from "../../infrastructure/components/raw-details.view.tsx";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import {
  admissionSelectionSummary,
  canSelectCandidate,
  countDispositions
} from "./discovery.model.ts";
import { type GameDiscoveryPreview } from "./discovery.read-model.ts";
import { ConfirmationKind, DISCOVERY_REVIEW } from "./discovery-review.service.ts";

const columnHelper = createColumnHelper<AdmissionCandidate>();

export const dispositionMessageKeys = {
  [DiscoveryDisposition.NewGame]: "discovery:dispositionNewGame",
  [DiscoveryDisposition.ReuseGame]: "discovery:dispositionReuseGame",
  [DiscoveryDisposition.ExistingInstallation]: "discovery:dispositionExistingInstallation",
  [DiscoveryDisposition.Conflict]: "discovery:dispositionConflict"
} as const;
const dispositionHintKeys = {
  [DiscoveryDisposition.NewGame]: "discovery:dispositionNewGameHint",
  [DiscoveryDisposition.ReuseGame]: "discovery:dispositionReuseGameHint",
  [DiscoveryDisposition.ExistingInstallation]: "discovery:dispositionExistingInstallationHint",
  [DiscoveryDisposition.Conflict]: "discovery:dispositionConflictHint"
} as const;
const validationMessageKeys = {
  [LocationValidationStatus.Valid]: "discovery:validationValid",
  [LocationValidationStatus.Invalid]: "discovery:validationInvalid",
  [LocationValidationStatus.Unverified]: "discovery:validationUnverified"
} as const;
const dispositions = [
  DiscoveryDisposition.NewGame,
  DiscoveryDisposition.ReuseGame,
  DiscoveryDisposition.ExistingInstallation,
  DiscoveryDisposition.Conflict
] as const;

export function DispositionBadge({ disposition }: { readonly disposition: DiscoveryDisposition }) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <span className="kg-disposition" data-disposition={disposition}>
      <span className="kg-disposition-mark" aria-hidden="true" />
      {t(dispositionMessageKeys[disposition])}
    </span>
  );
}

interface CandidateCellProps {
  readonly row: Row<AdmissionCandidate>;
}

// Stable component identities preserve focused controls when translated text changes.
function CandidateSelectionCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const consumed = useWebUIService(DISCOVERY_REVIEW).state.value.consumed;
  return (
    <Checkbox
      aria-label={t(consumed ? "discovery:disabledSelection" : "discovery:selectGame", {
        title: row.original.title
      })}
      checked={row.getIsSelected()}
      disabled={!row.getCanSelect()}
      onChange={row.getToggleSelectedHandler()}
    />
  );
}

function CandidateTitleCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const evidence = row.original.evidence[0];
  return (
    <div className="kg-candidate-title">
      <span className="kg-candidate-name">{row.original.title}</span>
      {evidence && (
        <span className="kg-candidate-path kg-mono" title={evidence.path}>
          {evidence.path}
        </span>
      )}
      <span className="kg-candidate-type kg-mono">
        {row.original.location.type}@{row.original.location.schemaVersion}
      </span>
      <RawDetails
        label={t("discovery:locationEvidence", { count: row.original.evidence.length })}
        value={{
          location: row.original.location,
          evidence: row.original.evidence,
          externalRefs: row.original.externalRefs
        }}
      />
    </div>
  );
}

function CandidateReviewCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const candidate = row.original;
  return (
    <div className="kg-candidate-review">
      <DispositionBadge disposition={candidate.disposition} />
      <span className="kg-hint">{t(dispositionHintKeys[candidate.disposition])}</span>
      {candidate.reason && <span className="kg-candidate-reason">{candidate.reason}</span>}
      {candidate.conflict && (
        <span className="kg-candidate-reason kg-mono">{candidate.conflict.kind}</span>
      )}
      {candidate.existingGameId && (
        <Link
          to="/games/$gameId"
          params={{ gameId: candidate.existingGameId }}
          className="kg-text-link"
        >
          {t("discovery:openExistingGame")}
        </Link>
      )}
    </div>
  );
}

function CandidateValidationCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const validation = row.original.locationValidation;
  return (
    <div className="kg-candidate-validation" data-status={validation.status}>
      <span>{t(validationMessageKeys[validation.status])}</span>
      {validation.reason && <span className="kg-hint">{validation.reason}</span>}
    </div>
  );
}

const cellLabels = {
  selection: "discovery:select",
  title: "discovery:game",
  disposition: "discovery:reviewResult",
  locationValidation: "discovery:locationValidation"
} as const;

/** Step 2: candidates, what each will do, and the metadata the selection would write. */
export function DiscoveryCandidates({
  preview,
  hostLabel
}: {
  readonly preview: GameDiscoveryPreview;
  readonly hostLabel: string;
}) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const discoveryReview = useWebUIService(DISCOVERY_REVIEW);
  const review = discoveryReview.state.value;
  const { selection, consumed, confirmation } = review;
  const busy = review.previewPending || review.admissionPending;
  // Which disposition is shown is a transient reading aid; selection stays in the service.
  const [shown, setShown] = useState<DiscoveryDisposition | undefined>(undefined);
  const counts = countDispositions(preview.candidates);
  const plan = admissionSelectionSummary(preview.candidates, selection);
  const eligible = preview.candidates.filter(canSelectCandidate).length;
  const columns = [
    columnHelper.display({
      id: "selection",
      header: t("discovery:select"),
      cell: CandidateSelectionCell
    }),
    columnHelper.accessor("title", { header: t("discovery:game"), cell: CandidateTitleCell }),
    columnHelper.accessor("disposition", {
      header: t("discovery:reviewResult"),
      cell: CandidateReviewCell
    }),
    columnHelper.accessor("locationValidation", {
      header: t("discovery:locationValidation"),
      cell: CandidateValidationCell
    })
  ];
  const table = useReactTable({
    data: preview.candidates,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (candidate) => candidate.candidateId,
    state: { rowSelection: selection },
    onRowSelectionChange: (update) => discoveryReview.select(update),
    enableRowSelection: (row) =>
      !consumed && !busy && !confirmation && canSelectCandidate(row.original)
  });
  const rows = table
    .getRowModel()
    .rows.filter((row) => shown === undefined || row.original.disposition === shown);
  const scopePaths = Array.isArray(preview.scope.paths)
    ? preview.scope.paths.filter((item): item is string => typeof item === "string")
    : [];
  const createdAt = Temporal.Instant.from(preview.createdAt).toLocaleString(locale.language.value, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  return (
    <section className="kg-panel kg-review" aria-labelledby="review-title">
      <div className="kg-panel-head">
        <span className="kg-step-index" aria-hidden="true">
          2
        </span>
        <div>
          <h2 id="review-title" className="kg-section-title">
            {t("discovery:reviewTitle")}
          </h2>
          <p className="kg-hint">
            {t("discovery:reviewContext", {
              host: hostLabel,
              source: preview.sourceId,
              time: createdAt
            })}
          </p>
        </div>
      </div>
      {scopePaths.length > 0 && (
        <ul className="kg-scope-paths" aria-label={t("discovery:scannedPaths")}>
          {scopePaths.map((path) => (
            <li key={path} className="kg-mono">
              {path}
            </li>
          ))}
        </ul>
      )}

      <fieldset className="kg-tally">
        <legend className="kg-visually-hidden">{t("discovery:tallyLabel")}</legend>
        <button
          type="button"
          className="kg-tally-item"
          aria-pressed={shown === undefined}
          onClick={() => setShown(undefined)}
        >
          <span className="kg-tally-count">{preview.candidates.length}</span>
          <span>{t("discovery:tallyAll")}</span>
        </button>
        {dispositions.map((disposition) => (
          <button
            key={disposition}
            type="button"
            className="kg-tally-item"
            data-disposition={disposition}
            aria-pressed={shown === disposition}
            disabled={counts[disposition] === 0}
            onClick={() => setShown(shown === disposition ? undefined : disposition)}
          >
            <span className="kg-tally-count">{counts[disposition]}</span>
            <span>
              <span className="kg-disposition-mark" aria-hidden="true" />
              {t(dispositionMessageKeys[disposition])}
            </span>
          </button>
        ))}
      </fieldset>

      {preview.diagnostics.length > 0 && (
        <details className="kg-notice" data-tone="warning">
          <summary>{t("discovery:scanDiagnostics", { count: preview.diagnostics.length })}</summary>
          <ul className="kg-plain-list">
            {preview.diagnostics.map((item, index) => (
              <li className="kg-mono" key={`${item.code}:${index}`}>
                {item.code}: {item.message}
                {item.path ? ` · ${item.path}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      {!preview.candidates.length ? (
        <div className="kg-empty" data-variant="inline">
          <h3>{t("discovery:noCandidatesTitle")}</h3>
          <p>{t("discovery:noCandidatesDescription")}</p>
        </div>
      ) : (
        <>
          <div className="kg-review-actions">
            <Button
              size="xs"
              variant="default"
              disabled={consumed || busy || !eligible}
              onClick={() => table.toggleAllRowsSelected(true)}
            >
              {t("discovery:selectAll", { eligible })}
            </Button>
            <Button
              size="xs"
              variant="subtle"
              disabled={consumed || busy || !plan.selected}
              onClick={() => table.resetRowSelection()}
            >
              {t("discovery:clearSelection")}
            </Button>
          </div>
          <div className="kg-table-wrap">
            <table className="kg-candidates">
              <caption>{t("discovery:tableCaption")}</caption>
              <thead>
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th key={header.id} scope="col" data-column={header.column.id}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-selected={row.getIsSelected() || undefined}
                    data-disposition={row.original.disposition}
                    data-consumed={consumed || undefined}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        data-column={cell.column.id}
                        data-label={t(cellLabels[cell.column.id as keyof typeof cellLabels])}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown !== undefined && rows.length < preview.candidates.length && (
            <p className="kg-hint">
              {t("discovery:filteredHint", {
                visible: rows.length,
                count: preview.candidates.length
              })}
            </p>
          )}
          <div className="kg-write-bar" aria-live="polite">
            <div className="kg-write-plan">
              <p className="kg-write-title">
                {t("discovery:reviewCount", {
                  count: preview.candidates.length,
                  selected: plan.selected
                })}
              </p>
              <p className="kg-hint">
                {plan.selected
                  ? t("discovery:selectionSummary", {
                      newGames: plan.newGameCandidates,
                      reuse: plan.reuseGameCandidates,
                      existing: plan.existingCandidates
                    })
                  : t("discovery:selectionNothing")}
              </p>
            </div>
            <Button
              disabled={!plan.selected || consumed || busy}
              onClick={() => discoveryReview.openConfirmation(ConfirmationKind.Admit)}
            >
              {t("discovery:reviewSelection", { count: plan.selected })}
            </Button>
          </div>
        </>
      )}
      {consumed && review.result?.status !== ImportStatus.RecoveryRequired && (
        <p className="kg-hint">{t("discovery:consumedDescription")}</p>
      )}
    </section>
  );
}
