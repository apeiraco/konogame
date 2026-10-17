export const RecordKind = {
  Workspace: "workspace",
  Game: "game",
  Host: "host",
  Installation: "installation"
} as const;
export type RecordKind = (typeof RecordKind)[keyof typeof RecordKind];
export const HostPlatform = { Windows: "windows", Linux: "linux", MacOS: "macos" } as const;
export type HostPlatform = (typeof HostPlatform)[keyof typeof HostPlatform];
export const SourceStatus = { Planned: "planned", Configured: "configured" } as const;
export type SourceStatus = (typeof SourceStatus)[keyof typeof SourceStatus];
export const LocationKind = {
  Absolute: "fs.absolute",
  Relative: "fs.relative",
  Managed: "managed"
} as const;
export type LocationKind = (typeof LocationKind)[keyof typeof LocationKind];
export const LaunchKind = { Executable: "executable", Uri: "uri", Managed: "managed" } as const;
export type LaunchKind = (typeof LaunchKind)[keyof typeof LaunchKind];
export const HistoryRecordStatus = {
  Recorded: "recorded",
  Conflict: "conflict",
  Failed: "failed",
  Unknown: "unknown"
} as const;
export type HistoryRecordStatus = (typeof HistoryRecordStatus)[keyof typeof HistoryRecordStatus];
export const HistoryAvailability = {
  Disabled: "disabled",
  Unavailable: "unavailable",
  Available: "available"
} as const;
export type HistoryAvailability = (typeof HistoryAvailability)[keyof typeof HistoryAvailability];
export const HistoryMode = { Disabled: "disabled", Adapter: "adapter" } as const;
export type HistoryMode = (typeof HistoryMode)[keyof typeof HistoryMode];
export const RenameStatus = {
  Renamed: "renamed",
  Unchanged: "unchanged",
  Conflict: "conflict",
  RecoveryRequired: "recovery-required",
  Failed: "failed"
} as const;
export type RenameStatus = (typeof RenameStatus)[keyof typeof RenameStatus];
export const WorkspaceFeature = {
  Inspect: "workspace.inspect",
  Rename: "workspace.rename",
  History: "workspace.history"
} as const;
export type WorkspaceFeature = (typeof WorkspaceFeature)[keyof typeof WorkspaceFeature];
export const WorkspacePort = {
  Configuration: "workspace.configuration",
  History: "workspace.history"
} as const;
export type WorkspacePort = (typeof WorkspacePort)[keyof typeof WorkspacePort];
export const WorkspaceOperation = {
  Read: "read",
  Rename: "rename",
  List: "list",
  FindOperation: "findOperation",
  Record: "record"
} as const;
export type WorkspaceOperation = (typeof WorkspaceOperation)[keyof typeof WorkspaceOperation];
export const WorkspaceCapability = {
  Records: "configuration.records",
  Rename: "configuration.rename",
  VersionedHistory: "history.versioned",
  IdempotentRecord: "history.idempotent-record"
} as const;
export type WorkspaceCapability = (typeof WorkspaceCapability)[keyof typeof WorkspaceCapability];
