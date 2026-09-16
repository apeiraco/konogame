import {
  type LocationContract,
  locationContractSchema,
  type ResourceReference
} from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import { Data } from "effect";
import { text } from "./records.ts";

/**
 * One navigation entry in a Workspace location browser. It is a value object: the same Location
 * may appear under different labels, and nothing here identifies a Workspace. `canBrowse` only
 * permits an attempt to list children; an empty listing is a valid answer.
 */
export interface WorkspaceBrowseEntry {
  readonly location: LocationContract;
  readonly label: string;
  readonly canBrowse: boolean;
}

/** One level of children. `complete` is false when the Adapter stopped at its listing limit. */
export interface WorkspaceBrowseListing {
  readonly entries: readonly WorkspaceBrowseEntry[];
  readonly complete: boolean;
}

export const workspaceBrowseEntrySchema = type({
  "+": "reject",
  location: locationContractSchema,
  label: text,
  canBrowse: "boolean"
});
export const workspaceBrowseListingSchema = type({
  "+": "reject",
  entries: workspaceBrowseEntrySchema.array(),
  complete: "boolean"
});

/** Default and maximum direct children returned for one listed location. */
export const WORKSPACE_BROWSE_LIMIT = { Default: 500, Maximum: 2000 } as const;
export const workspaceBrowseLimitSchema = type("number.integer")
  .atLeast(1)
  .atMost(WORKSPACE_BROWSE_LIMIT.Maximum)
  .describe(`Direct children to return; defaults to ${WORKSPACE_BROWSE_LIMIT.Default}`);

export const WorkspaceBrowseFailureKind = {
  /** The daemon process may not list this location. */
  Denied: "denied",
  /** The location no longer exists or is not a container. */
  Missing: "missing",
  /** The selected Adapter cannot interpret this Location type or schema. */
  Unsupported: "unsupported",
  Failed: "failed"
} as const;
export type WorkspaceBrowseFailureKind =
  (typeof WorkspaceBrowseFailureKind)[keyof typeof WorkspaceBrowseFailureKind];

export class WorkspaceBrowseError extends Data.TaggedError("WorkspaceBrowseError")<{
  readonly issue: {
    readonly kind: WorkspaceBrowseFailureKind;
    /** Native platform code such as EACCES, preserved for diagnostics. */
    readonly code?: string;
  };
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** What a configuration Adapter found at a selected location, before any formal read. */
export const WorkspaceProbeStatus = {
  /** The configuration marker exists. A formal read may still reject the configuration. */
  Present: "present",
  /** No marker; the location may still be browsed further. */
  Absent: "absent",
  /** The daemon process may not inspect this location. */
  Denied: "denied",
  /** The configuration Adapter does not support the resolved resource type. */
  Unsupported: "unsupported",
  /** No configuration Adapter offers a probe, or the Location could not be resolved. */
  Unavailable: "unavailable"
} as const;
export type WorkspaceProbeStatus = (typeof WorkspaceProbeStatus)[keyof typeof WorkspaceProbeStatus];

export interface WorkspaceProbeInput {
  readonly resource: ResourceReference;
}

/**
 * `root` is the configuration Adapter's own handle for the formal read, so callers never derive a
 * root from Location data.
 */
export interface WorkspaceProbeResult {
  readonly status: WorkspaceProbeStatus;
  readonly root?: string;
  readonly reason?: string;
}

export const workspaceProbeResultSchema = type({
  "+": "reject",
  status: type.enumerated(...Object.values(WorkspaceProbeStatus)),
  "root?": text,
  "reason?": text
});
