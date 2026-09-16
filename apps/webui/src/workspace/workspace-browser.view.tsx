import { WorkspaceBrowseFailureKind, WorkspaceProbeStatus } from "@konogame/workspace/contracts";
import {
  Button,
  Modal,
  type RenderTreeNodePayload,
  Tree,
  type TreeNodeData,
  useTree
} from "@mantine/core";
import { type UseQueryResult, useQueries, useQuery } from "@tanstack/react-query";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useWebUIService } from "../app/use-webui-service.ts";
import { describeError } from "../infrastructure/components/error-notice.view.tsx";
import { FolderIcon } from "../infrastructure/components/icons.tsx";
import { runUiEffect } from "../infrastructure/effect/run-ui-effect.ts";
import { ApiRequestError } from "../infrastructure/http/daemon-http.ts";
import { LOCALE } from "../infrastructure/i18n/locale.service.ts";
import { workspaceKeys } from "./workspace.query-keys.ts";
import {
  type WorkspaceBrowseEntryView,
  type WorkspaceLocation,
  type WorkspaceLocationListing
} from "./workspace.read-model.ts";
import { WORKSPACE_OPEN } from "./workspace-open.service.ts";
import { WORKSPACE_QUERY } from "./workspace-query.service.ts";

// Starting points have no Location; every other listing is keyed by its complete Location.
const ROOT = "@start";
const SEPARATOR = "\u001f";
const PseudoKind = {
  Loading: "loading",
  Empty: "empty",
  Truncated: "truncated",
  Error: "error"
} as const;
type PseudoKind = (typeof PseudoKind)[keyof typeof PseudoKind];

/** An opaque cache key. The view never reads Location data. */
function locationKey(location: WorkspaceLocation) {
  return JSON.stringify(location);
}

const listFailureKeys = {
  [WorkspaceBrowseFailureKind.Denied]: "workspace:listDenied",
  [WorkspaceBrowseFailureKind.Missing]: "workspace:listMissing",
  [WorkspaceBrowseFailureKind.Unsupported]: "workspace:listUnsupported",
  [WorkspaceBrowseFailureKind.Failed]: "workspace:listFailed"
} as const;
const probeMessageKeys = {
  [WorkspaceProbeStatus.Present]: "workspace:probePresent",
  [WorkspaceProbeStatus.Absent]: "workspace:probeAbsent",
  [WorkspaceProbeStatus.Denied]: "workspace:probeDenied",
  [WorkspaceProbeStatus.Unsupported]: "workspace:probeUnsupported",
  [WorkspaceProbeStatus.Unavailable]: "workspace:probeUnavailable"
} as const;

function listFailureKind(error: unknown) {
  const issues = error instanceof ApiRequestError ? error.issues : undefined;
  const kind =
    issues !== null && typeof issues === "object" && "kind" in issues ? issues.kind : undefined;
  return Object.values(WorkspaceBrowseFailureKind).find((item) => item === kind);
}

interface ListingResult {
  readonly data: WorkspaceLocationListing | undefined;
  readonly error: unknown;
  readonly isPending: boolean;
  readonly isError: boolean;
}

// A stable combine keeps the results referentially equal until a listing actually changes.
function combineListings(results: readonly UseQueryResult<WorkspaceLocationListing>[]) {
  return results.map(
    ({ data, error, isPending, isError }): ListingResult => ({ data, error, isPending, isError })
  );
}

function sameExpansion(
  left: Readonly<Record<string, boolean>>,
  right: Readonly<Record<string, boolean>>
) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => !!left[key] === !!right[key]);
}

function expandedLocationKeys(expanded: Readonly<Record<string, boolean>>) {
  const keys = new Set<string>();
  for (const [value, open] of Object.entries(expanded)) {
    const key = value.split(SEPARATOR).at(-1);
    if (open && key && key !== ROOT) {
      keys.add(key);
    }
  }
  return [...keys];
}

/** Node values are path-unique; listings are looked up by the opaque Location key alone. */
function buildTree(
  listings: ReadonlyMap<string, ListingResult>,
  expanded: Readonly<Record<string, boolean>>
) {
  const entries = new Map<string, WorkspaceBrowseEntryView>();
  const pseudo = new Map<string, { kind: PseudoKind; error?: unknown }>();
  function children(parentValue: string, key: string): TreeNodeData[] {
    const listing = listings.get(key);
    const marker = (kind: PseudoKind, error?: unknown): TreeNodeData => {
      const value = `${parentValue}${SEPARATOR}#${kind}`;
      pseudo.set(value, { kind, error });
      return { value, label: kind };
    };
    if (!listing || listing.isPending) {
      return [marker(PseudoKind.Loading)];
    }
    if (listing.isError || !listing.data) {
      return [marker(PseudoKind.Error, listing.error)];
    }
    const nodes = listing.data.entries.map((entry): TreeNodeData => {
      const childKey = locationKey(entry.location);
      const value = `${parentValue}${SEPARATOR}${childKey}`;
      entries.set(value, entry);
      return {
        value,
        label: entry.label,
        hasChildren: entry.canBrowse,
        ...(expanded[value] ? { children: children(value, childKey) } : {})
      };
    });
    if (!nodes.length) {
      return [marker(listing.data.complete ? PseudoKind.Empty : PseudoKind.Truncated)];
    }
    return listing.data.complete ? nodes : [...nodes, marker(PseudoKind.Truncated)];
  }
  return { data: children(ROOT, ROOT), entries, pseudo };
}
/**
 * Browses daemon-side locations for a Workspace. Expansion, focus and highlight are local to this
 * dialog; listings are cached by Query; opening goes through the same formal read as typed paths.
 */
export function WorkspaceBrowserDialog({
  opened,
  onClose,
  onOpened,
  returnFocus = true
}: {
  readonly opened: boolean;
  /** Cancel or dismiss. */
  readonly onClose: () => void;
  /** The formal read succeeded and the session switched; the owner closes the dialog. */
  readonly onOpened: () => void;
  /** False when the owner restores focus itself because the trigger is no longer mounted. */
  readonly returnFocus?: boolean;
}) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const workspace = useWebUIService(WORKSPACE_QUERY);
  const opener = useWebUIService(WORKSPACE_OPEN);
  const pendingRoot = opener.pending.value;
  const failure = opener.failure.value;
  const [expanded, setExpanded] = useState<Readonly<Record<string, boolean>>>({});
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const tree = useTree({
    expandedState: expanded,
    // Tree re-initializes whenever its data changes; ignore updates with unchanged content so
    // re-initialization cannot overwrite a newer expansion.
    onExpandedStateChange: (next) =>
      setExpanded((previous) => (sameExpansion(previous, next) ? previous : next)),
    selectedState: selected ? [selected] : [],
    onSelectedStateChange: (values) => {
      const value = values.at(-1);
      if (value) {
        select(value);
      }
    }
  });

  // One listing per expanded location; the same Location under two branches shares a request.
  const expandedLocations = expandedLocationKeys(expanded);
  const listingKeys = [ROOT, ...expandedLocations];
  const listings = useQueries({
    queries: listingKeys.map((key) => ({
      queryKey: workspaceKeys.locations(key),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        runUiEffect(
          workspace.listLocations(
            key === ROOT ? undefined : (JSON.parse(key) as WorkspaceLocation)
          ),
          signal
        ),
      enabled: opened,
      staleTime: 30_000
    })),
    combine: combineListings
  });
  const { data, entries, pseudo } = useMemo(
    () => buildTree(new Map(listingKeys.map((key, index) => [key, listings[index]!])), expanded),
    // A changed key set also changes the combined listings, so these two inputs suffice.
    [listings, expanded]
  );
  const selectedEntry = selected ? entries.get(selected) : undefined;
  const selectedKey = selectedEntry ? locationKey(selectedEntry.location) : "";

  // Only the selected location is probed. The result is keyed by that location, so an older
  // answer can never enable opening a newer selection.
  const probe = useQuery({
    queryKey: workspaceKeys.probe(selectedKey),
    queryFn: ({ signal }) => runUiEffect(workspace.probeLocation(selectedEntry!.location), signal),
    enabled: opened && !!selectedEntry,
    staleTime: 10_000
  });
  const root = probe.data?.status === WorkspaceProbeStatus.Present ? probe.data.root : undefined;
  const configurationAdapterId = probe.data?.adapterResolutionPlan?.resolvedAdapters[0]?.adapterId;
  const opening = root !== undefined && pendingRoot === root;

  function select(value: string) {
    if (entries.has(value)) {
      opener.cancel();
      setSelected(value);
      opener.clearFailure();
    }
  }
  function open() {
    if (!root || !configurationAdapterId || pendingRoot) {
      return;
    }
    void runUiEffect(opener.open(root, configurationAdapterId)).then((done) => {
      if (done) {
        onOpened();
      }
    });
  }
  function close() {
    opener.cancel();
    onClose();
  }
  function onTreeKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    if (event.key !== "Enter" || !(event.target instanceof HTMLElement)) {
      return;
    }
    const value = event.target.closest<HTMLElement>("[data-value]")?.dataset.value;
    if (!value || !entries.has(value)) {
      return;
    }
    event.preventDefault();
    // Enter selects; on an already selected, confirmed Workspace it opens.
    if (value === selected && root) {
      open();
    } else {
      select(value);
    }
  }

  function renderNode({
    node,
    expanded: isExpanded,
    hasChildren,
    elementProps
  }: RenderTreeNodePayload) {
    const marker = pseudo.get(node.value);
    if (marker) {
      const failureKind =
        marker.kind === PseudoKind.Error ? listFailureKind(marker.error) : undefined;
      return (
        <div
          {...elementProps}
          className={`${elementProps.className} kg-tree-note`}
          data-kind={marker.kind}
        >
          {marker.kind === PseudoKind.Loading && t("workspace:listLoading")}
          {marker.kind === PseudoKind.Empty && t("workspace:listEmpty")}
          {marker.kind === PseudoKind.Truncated && t("workspace:listTruncated")}
          {marker.kind === PseudoKind.Error &&
            (failureKind ? t(listFailureKeys[failureKind]) : describeError(marker.error, t))}
        </div>
      );
    }
    return (
      <div
        {...elementProps}
        className={`${elementProps.className} kg-tree-node`}
        // A treeitem is otherwise named by its whole expanded subtree; name it by its own label.
        ref={(element) => {
          element?.parentElement?.setAttribute("aria-label", String(node.label));
        }}
      >
        <span
          className="kg-tree-chevron"
          data-expanded={isExpanded || undefined}
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) {
              tree.toggleExpanded(node.value);
            }
          }}
        >
          {hasChildren ? "›" : ""}
        </span>
        <FolderIcon size={15} />
        <span className="kg-tree-label">{node.label}</span>
      </div>
    );
  }

  const probeTone =
    probe.data?.status === WorkspaceProbeStatus.Present
      ? "ok"
      : probe.data?.status === WorkspaceProbeStatus.Absent
        ? "neutral"
        : "warning";
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={t("workspace:browseTitle")}
      size="min(680px, calc(100vw - 32px))"
      centered
      returnFocus={returnFocus}
      closeButtonProps={{ "aria-label": t("workspace:browseClose") }}
      classNames={{ title: "kg-modal-title", body: "kg-browser" }}
    >
      <p className="kg-hint">{t("workspace:browseDescription")}</p>
      <div className="kg-tree-frame">
        <Tree
          data={data}
          tree={tree}
          expandOnClick={false}
          selectOnClick
          expandOnSpace
          levelOffset="md"
          aria-label={t("workspace:browseTree")}
          renderNode={renderNode}
          onKeyDown={onTreeKeyDown}
        />
      </div>
      <div className="kg-browser-status" aria-live="polite">
        {selectedEntry ? (
          <>
            <p className="kg-browser-selected">
              <span>{t("workspace:browseSelected")}</span>
              <strong>{selectedEntry.label}</strong>
            </p>
            {probe.isPending && <p className="kg-hint">{t("workspace:probeChecking")}</p>}
            {probe.isError && <p className="kg-field-error">{describeError(probe.error, t)}</p>}
            {probe.data && (
              <p className="kg-probe" data-tone={probeTone}>
                {t(probeMessageKeys[probe.data.status])}
                {probe.data.status === WorkspaceProbeStatus.Unavailable && probe.data.reason
                  ? ` ${probe.data.reason}`
                  : ""}
              </p>
            )}
            {failure && failure.root === root && (
              <p className="kg-field-error" role="alert">
                {t("workspace:openFailed", { reason: describeError(failure.error, t) })}
              </p>
            )}
          </>
        ) : (
          <p className="kg-hint">{t("workspace:browseNothingSelected")}</p>
        )}
      </div>
      <div className="kg-confirm-actions">
        <Button variant="default" onClick={close}>
          {t("workspace:browseCancel")}
        </Button>
        <Button
          disabled={!root || !configurationAdapterId || (!!pendingRoot && !opening)}
          loading={opening}
          onClick={open}
        >
          {t("workspace:browseOpen")}
        </Button>
      </div>
    </Modal>
  );
}
