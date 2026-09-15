import { type AdmissionCandidate } from "@konogame/game/admission";
import { DiscoveryDisposition } from "@konogame/game/contracts";
import { LocationValidationStatus } from "@konogame/infrastructure/contracts";
import { ImportStatus, SourceStatus } from "@konogame/workspace/contracts";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Code,
  Group,
  JsonInput,
  Loader,
  Modal,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  Title
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Row,
  useReactTable
} from "@tanstack/react-table";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { RawDetails } from "../../infrastructure/components/raw-details.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { workspaceKeys } from "../../workspace/workspace.query-keys.ts";
import { WORKSPACE_QUERY } from "../../workspace/workspace-query.service.ts";
import { WorkspaceRequired } from "../../workspace/workspace-required.view.tsx";
import { WORKSPACE_SESSION } from "../../workspace/workspace-session.service.ts";
import {
  ConfirmationKind,
  DISCOVERY_REVIEW,
  DiscoveryFormErrorCode
} from "./discovery-review.service.ts";

function canSelect(candidate: AdmissionCandidate) {
  return candidate.disposition !== DiscoveryDisposition.Conflict;
}

const columnHelper = createColumnHelper<AdmissionCandidate>();

const dispositionMessageKeys = {
  [DiscoveryDisposition.NewGame]: "discovery:dispositionNewGame",
  [DiscoveryDisposition.ReuseGame]: "discovery:dispositionReuseGame",
  [DiscoveryDisposition.ExistingInstallation]: "discovery:dispositionExistingInstallation",
  [DiscoveryDisposition.Conflict]: "discovery:dispositionConflict"
} as const;
const validationMessageKeys = {
  [LocationValidationStatus.Valid]: "discovery:validationValid",
  [LocationValidationStatus.Invalid]: "discovery:validationInvalid",
  [LocationValidationStatus.Unverified]: "discovery:validationUnverified"
} as const;

interface CandidateCellProps {
  readonly row: Row<AdmissionCandidate>;
}

// Stable component identities preserve focused controls when translated text changes.
function CandidateSelectionCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <Checkbox
      aria-label={t("discovery:selectGame", { title: row.original.title })}
      checked={row.getIsSelected()}
      disabled={!row.getCanSelect()}
      onChange={row.getToggleSelectedHandler()}
    />
  );
}

function CandidateTitleCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <Stack gap={4}>
      <Text fw={600}>{row.original.title}</Text>
      <Text size="xs" c="dimmed">
        {row.original.location.type}
      </Text>
      <RawDetails
        label={t("discovery:locationEvidence")}
        value={{
          location: row.original.location,
          evidence: row.original.evidence,
          externalRefs: row.original.externalRefs
        }}
      />
    </Stack>
  );
}

function CandidateReviewCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <Stack gap={4}>
      <Badge variant="light" color={canSelect(row.original) ? "blue" : "red"}>
        {t(dispositionMessageKeys[row.original.disposition])}
      </Badge>
      {row.original.reason && <Text size="sm">{row.original.reason}</Text>}
      {row.original.conflict && (
        <Text size="xs" c="red">
          {row.original.conflict.kind}
        </Text>
      )}
      {row.original.existingGameId && (
        <Text size="xs" c="dimmed">
          {t("discovery:existingGame", { id: row.original.existingGameId })}
        </Text>
      )}
    </Stack>
  );
}

function CandidateValidationCell({ row }: CandidateCellProps) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <Stack gap={4}>
      <Text size="sm">{t(validationMessageKeys[row.original.locationValidation.status])}</Text>
      {row.original.locationValidation.reason && (
        <Text size="xs">{row.original.locationValidation.reason}</Text>
      )}
    </Stack>
  );
}

export function DiscoveryPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const session = useWebUIService(WORKSPACE_SESSION);
  const discoveryReview = useWebUIService(DISCOVERY_REVIEW);
  const workspace = useWebUIService(WORKSPACE_QUERY);
  const workspaceRoot = session.workspaceRoot.value;
  const review = discoveryReview.state.value;
  const { hostId, sourceId, paths, depth, exclude, advanced, scopeJson } = review.form;
  const { preview, selection, result, consumed, confirmation, confirmed, formError } = review;
  const formErrorMessages = {
    [DiscoveryFormErrorCode.InvalidJson]: "discovery:formInvalidJson",
    [DiscoveryFormErrorCode.ScopeObjectRequired]: "discovery:formScopeObject",
    [DiscoveryFormErrorCode.PathsRequired]: "discovery:formPathsRequired"
  } as const;
  const inspection = useQuery({
    queryKey: workspaceKeys.inspection(workspaceRoot),
    queryFn: ({ signal }) => runUiEffect(workspace.inspect(workspaceRoot), signal),
    enabled: !!workspaceRoot
  });
  const host = inspection.data?.hosts.find((item) => item.id === hostId);
  const source = host?.sources.find((item) => item.id === sourceId);
  const selectedIds = Object.keys(selection);
  const selectedCandidates =
    preview?.candidates.filter((item) => selection[item.candidateId]) ?? [];
  const columns = [
    columnHelper.display({
      id: "selection",
      header: t("discovery:select"),
      cell: CandidateSelectionCell
    }),
    columnHelper.accessor("title", {
      header: t("discovery:game"),
      cell: CandidateTitleCell
    }),
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
    data: preview?.candidates ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (candidate) => candidate.candidateId,
    state: { rowSelection: selection },
    onRowSelectionChange: (update) => discoveryReview.select(update),
    enableRowSelection: (row) =>
      !consumed &&
      !review.previewPending &&
      !review.admissionPending &&
      !confirmation &&
      canSelect(row.original)
  });
  const busy = review.previewPending || review.admissionPending;
  const recoveryRequired = result?.status === ImportStatus.RecoveryRequired;

  if (!workspaceRoot) {
    return <WorkspaceRequired />;
  }
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text c="dimmed" size="sm">
            {t("discovery:eyebrow")}
          </Text>
          <Title order={1}>{t("discovery:title")}</Title>
        </div>
        <Button component={Link} to="/" variant="subtle">
          {t("discovery:backToWall")}
        </Button>
      </Group>
      <Text c="dimmed">{t("discovery:introduction")}</Text>
      {inspection.isPending && <Loader aria-label={t("discovery:loadingSources")} />}
      {inspection.isError && (
        <ErrorNotice error={inspection.error} retry={() => void inspection.refetch()} />
      )}
      {inspection.data && !inspection.data.hosts.length && (
        <Alert color="yellow" title={t("discovery:noHostsTitle")}>
          {t("discovery:noHostsDescription")}
        </Alert>
      )}
      <Card withBorder>
        <Stack>
          <Group grow align="start">
            <Select
              label={t("discovery:hostLabel")}
              placeholder={t("discovery:hostPlaceholder")}
              data={(inspection.data?.hosts ?? []).map((item) => ({
                value: item.id,
                label: item.label
              }))}
              value={hostId || null}
              disabled={busy || recoveryRequired}
              onChange={(value) => discoveryReview.updateForm({ hostId: value ?? "" })}
            />
            <Select
              label={t("discovery:sourceLabel")}
              placeholder={t("discovery:sourcePlaceholder")}
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
              disabled={!host || busy || recoveryRequired}
              onChange={(value) => discoveryReview.updateForm({ sourceId: value ?? "" })}
            />
          </Group>
          {host && (
            <Text size="xs" c="dimmed">
              {t("discovery:rootsHint")}
            </Text>
          )}
          <Checkbox
            label={t("discovery:advancedLabel")}
            checked={advanced}
            disabled={busy || recoveryRequired}
            onChange={(event) =>
              discoveryReview.updateForm({ advanced: event.currentTarget.checked })
            }
          />
          {advanced ? (
            <JsonInput
              label={t("discovery:scopeLabel")}
              description={t("discovery:scopeDescription")}
              validationError={t("discovery:formInvalidJson")}
              value={scopeJson}
              onChange={(value) => discoveryReview.updateForm({ scopeJson: value })}
              minRows={6}
              disabled={busy || recoveryRequired}
            />
          ) : (
            <>
              <Textarea
                label={t("discovery:pathsLabel")}
                placeholder={t("discovery:pathsPlaceholder")}
                description={t("discovery:pathsDescription")}
                value={paths}
                onChange={(event) =>
                  discoveryReview.updateForm({ paths: event.currentTarget.value })
                }
                minRows={3}
                disabled={busy || recoveryRequired}
              />
              <Group align="start" grow>
                <NumberInput
                  label={t("discovery:depthLabel")}
                  description={t("discovery:depthDescription")}
                  min={0}
                  max={16}
                  allowDecimal={false}
                  value={depth}
                  onChange={(value) => discoveryReview.updateForm({ depth: value })}
                  disabled={busy || recoveryRequired}
                />
                <Textarea
                  label={t("discovery:excludeLabel")}
                  placeholder={t("discovery:excludePlaceholder")}
                  value={exclude}
                  onChange={(event) =>
                    discoveryReview.updateForm({ exclude: event.currentTarget.value })
                  }
                  disabled={busy || recoveryRequired}
                />
              </Group>
            </>
          )}
          {formError && (
            <Alert color="red" role="alert">
              {t(formErrorMessages[formError.code], { ...formError.params })}
            </Alert>
          )}
          <Button
            style={{ alignSelf: "start" }}
            loading={review.previewPending}
            disabled={
              !hostId ||
              !source ||
              source.status !== SourceStatus.Configured ||
              busy ||
              recoveryRequired
            }
            onClick={() => void runUiEffect(discoveryReview.preview())}
          >
            {t("discovery:generatePreview")}
          </Button>
        </Stack>
      </Card>
      {review.previewError !== undefined && <ErrorNotice error={review.previewError} />}
      {review.admissionError !== undefined && (
        <>
          <ErrorNotice error={review.admissionError} />
          <Alert color="yellow" title={t("discovery:previewAgainTitle")}>
            {t("discovery:previewAgainDescription")}
          </Alert>
        </>
      )}
      {result && (
        <Alert
          color={
            result.status === ImportStatus.Imported || result.status === ImportStatus.Unchanged
              ? "teal"
              : "yellow"
          }
          title={
            result.status === ImportStatus.Imported
              ? t("discovery:importedTitle")
              : result.status === ImportStatus.Unchanged
                ? t("discovery:unchangedTitle")
                : result.status === ImportStatus.RecoveryRequired
                  ? t("discovery:recoveryTitle")
                  : t("discovery:incompleteTitle")
          }
          role="status"
        >
          <Stack gap="sm">
            {result.reason && <Text size="sm">{result.reason}</Text>}
            <Text size="xs">{t("discovery:operationId", { id: result.operationId })}</Text>
            {recoveryRequired ? (
              <>
                <Text size="sm">{t("discovery:recoveryDescription")}</Text>
                <Button
                  color="orange"
                  variant="light"
                  onClick={() => discoveryReview.openConfirmation(ConfirmationKind.Recover)}
                >
                  {t("discovery:reviewRecovery")}
                </Button>
              </>
            ) : result.status === ImportStatus.Imported ||
              result.status === ImportStatus.Unchanged ? (
              <Button component={Link} to="/" variant="light">
                {t("discovery:viewWall")}
              </Button>
            ) : (
              <Text size="sm">{t("discovery:changedDescription")}</Text>
            )}
            <RawDetails label={t("discovery:importDetails")} value={result} />
          </Stack>
        </Alert>
      )}
      {preview && (
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={2}>{t("discovery:reviewTitle")}</Title>
            <Text aria-live="polite">
              {t("discovery:reviewCount", {
                count: preview.candidates.length,
                selected: selectedIds.length
              })}
            </Text>
          </Group>
          <Text size="sm" c="dimmed">
            {t("discovery:reviewContext", { host: host?.label ?? "", source: preview.sourceId })}
          </Text>
          <RawDetails
            label={t("discovery:scanPlan")}
            value={{
              scope: preview.scope,
              adapterResolutionPlan: preview.adapterResolutionPlan,
              operationId: preview.operationId
            }}
          />
          {preview.diagnostics.length > 0 && (
            <Alert color="yellow" title={t("discovery:scanDiagnostics")}>
              {preview.diagnostics.map((item, index) => (
                <Text size="sm" key={`${item.code}:${index}`}>
                  {item.code}: {item.message}
                  {item.path ? ` · ${item.path}` : ""}
                </Text>
              ))}
            </Alert>
          )}
          {!preview.candidates.length ? (
            <Alert title={t("discovery:noCandidatesTitle")}>
              {t("discovery:noCandidatesDescription")}
            </Alert>
          ) : (
            <>
              <Group>
                <Button
                  size="xs"
                  variant="light"
                  disabled={consumed || busy}
                  onClick={() => table.toggleAllRowsSelected(true)}
                >
                  {t("discovery:selectAll")}
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  disabled={consumed || busy}
                  onClick={() => table.resetRowSelection()}
                >
                  {t("discovery:clearSelection")}
                </Button>
              </Group>
              <Table.ScrollContainer minWidth={620}>
                <Table highlightOnHover captionSide="bottom">
                  <Table.Caption>{t("discovery:tableCaption")}</Table.Caption>
                  <Table.Thead>
                    {table.getHeaderGroups().map((group) => (
                      <Table.Tr key={group.id}>
                        {group.headers.map((header) => (
                          <Table.Th key={header.id}>
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Thead>
                  <Table.Tbody>
                    {table.getRowModel().rows.map((row) => (
                      <Table.Tr key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <Table.Td key={cell.id} style={{ verticalAlign: "top" }}>
                            {consumed && cell.column.id === "selection" ? (
                              <Checkbox
                                aria-label={t("discovery:disabledSelection", {
                                  title: row.original.title
                                })}
                                checked={row.getIsSelected()}
                                disabled
                              />
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              <Button
                style={{ alignSelf: "start" }}
                disabled={!selectedIds.length || consumed || busy}
                onClick={() => discoveryReview.openConfirmation(ConfirmationKind.Admit)}
              >
                {t("discovery:reviewSelection", { count: selectedIds.length })}
              </Button>
            </>
          )}
          {consumed && !recoveryRequired && (
            <Text c="dimmed" size="sm">
              {t("discovery:consumedDescription")}
            </Text>
          )}
        </Stack>
      )}
      <Modal
        opened={confirmation !== undefined}
        onClose={() => discoveryReview.closeConfirmation()}
        title={
          confirmation === ConfirmationKind.Recover
            ? t("discovery:confirmRecoveryTitle")
            : t("discovery:confirmAdmissionTitle")
        }
        centered
        closeButtonProps={{ "aria-label": t("discovery:closeDialog") }}
        closeOnClickOutside={!review.admissionPending}
        closeOnEscape={!review.admissionPending}
        withCloseButton={!review.admissionPending}
      >
        <Stack>
          <Text size="sm">{t("discovery:workspaceLabel")}</Text>
          <Code block>{workspaceRoot}</Code>
          {confirmation === ConfirmationKind.Admit ? (
            <>
              <Text>{t("discovery:confirmSelection", { count: selectedCandidates.length })}</Text>
              {selectedCandidates.map((item) => (
                <Text size="sm" key={item.candidateId}>
                  • {item.title} · {t(dispositionMessageKeys[item.disposition])}
                </Text>
              ))}
              <Text size="sm" c="dimmed">
                {t("discovery:admissionDescription")}
              </Text>
            </>
          ) : (
            <>
              <Text size="sm">{t("discovery:recoveryOperation")}</Text>
              <Code>{result?.operationId}</Code>
            </>
          )}
          <Checkbox
            label={
              confirmation === ConfirmationKind.Recover
                ? t("discovery:confirmRecoveryCheckbox")
                : t("discovery:confirmAdmissionCheckbox")
            }
            checked={confirmed}
            disabled={review.admissionPending}
            onChange={(event) => discoveryReview.confirm(event.currentTarget.checked)}
          />
          <Group justify="end">
            <Button
              variant="default"
              disabled={review.admissionPending}
              onClick={() => discoveryReview.closeConfirmation()}
            >
              {t("discovery:cancel")}
            </Button>
            <Button
              disabled={!confirmed}
              loading={review.admissionPending}
              onClick={() => void runUiEffect(discoveryReview.submit())}
            >
              {confirmation === ConfirmationKind.Recover
                ? t("discovery:confirmRecovery")
                : t("discovery:confirmAdmission")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
