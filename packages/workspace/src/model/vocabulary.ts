import { HistoryCapability } from "@konogame/infrastructure/contracts";

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
  Initialize: "workspace.initialize",
  RecoverInitialize: "workspace.recover-initialize",
  Edit: "workspace.edit",
  RecoverEdit: "workspace.recover-edit",
  Inspect: "workspace.inspect",
  Rename: "workspace.rename",
  Import: "workspace.import",
  RecoverImport: "workspace.recover-import",
  History: "workspace.history"
} as const;
export type WorkspaceFeature = (typeof WorkspaceFeature)[keyof typeof WorkspaceFeature];
export const WorkspacePort = {
  Configuration: "workspace.configuration",
  History: "workspace.history"
} as const;
export type WorkspacePort = (typeof WorkspacePort)[keyof typeof WorkspacePort];
export const WorkspaceOperation = {
  Initialize: "initialize",
  RecoverInitialize: "recover-initialize",
  Edit: "edit",
  RecoverEdit: "recover-edit",
  Read: "read",
  Rename: "rename",
  Import: "import",
  RecoverImport: "recover-import",
  List: "list",
  FindOperation: "find-operation",
  Record: "record"
} as const;
export type WorkspaceOperation = (typeof WorkspaceOperation)[keyof typeof WorkspaceOperation];
export const WorkspaceCapability = {
  Initialize: "configuration.initialize",
  InitializeRecovery: "configuration.initialize-recovery",
  Edit: "configuration.edit",
  EditRecovery: "configuration.edit-recovery",
  Records: "configuration.records",
  Rename: "configuration.rename",
  Import: "configuration.import",
  ImportRecovery: "configuration.import-recovery",
  VersionedHistory: HistoryCapability.Versioned,
  IdempotentRecord: HistoryCapability.IdempotentRecord
} as const;
export type WorkspaceCapability = (typeof WorkspaceCapability)[keyof typeof WorkspaceCapability];
export const ImportStatus = {
  Imported: "imported",
  Unchanged: "unchanged",
  Conflict: "conflict",
  Failed: "failed",
  RecoveryRequired: "recovery-required"
} as const;
export type ImportStatus = (typeof ImportStatus)[keyof typeof ImportStatus];

export const ConfigurationEditKind = {
  MetadataReplace: "metadata.replace",
  SettingsReplace: "settings.replace",
  HostCreate: "host.create",
  HostRootsReplace: "host.roots.replace",
  HostSourcesReplace: "host.sources.replace"
} as const;
export type ConfigurationEditKind =
  (typeof ConfigurationEditKind)[keyof typeof ConfigurationEditKind];
export const SettingsTargetKind = {
  Workspace: RecordKind.Workspace,
  Game: RecordKind.Game,
  Host: RecordKind.Host,
  HostGame: "host-game",
  Installation: RecordKind.Installation
} as const;
export type SettingsTargetKind = (typeof SettingsTargetKind)[keyof typeof SettingsTargetKind];
export const InitializeStatus = {
  Initialized: "initialized",
  RecoveryRequired: "recovery-required",
  Conflict: "conflict",
  Failed: "failed"
} as const;
export type InitializeStatus = (typeof InitializeStatus)[keyof typeof InitializeStatus];
export const EditStatus = {
  Edited: "edited",
  Unchanged: "unchanged",
  Conflict: "conflict",
  RecoveryRequired: "recovery-required",
  Failed: "failed"
} as const;
export type EditStatus = (typeof EditStatus)[keyof typeof EditStatus];
