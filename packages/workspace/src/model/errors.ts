import {
  type LocationError,
  SchemaValidationError,
  type UnexpectedBoundaryError
} from "@konogame/infrastructure/contracts";
import { Data } from "effect";
import { type HistoryMode, type RecordKind } from "./vocabulary.ts";

export const WorkspaceInvalidInputKind = {
  HistoryAdapter: "history-adapter",
  UniformName: "uniform-name",
  FileNameLength: "file-name-length",
  TargetKind: "target-kind",
  MetadataShape: "metadata-shape",
  ExternalKey: "external-key"
} as const;
export type WorkspaceInvalidInputKind =
  (typeof WorkspaceInvalidInputKind)[keyof typeof WorkspaceInvalidInputKind];
export const UniformNameProblem = {
  Empty: "empty",
  UnpairedSurrogate: "unpaired-surrogate"
} as const;
export type UniformNameProblem = (typeof UniformNameProblem)[keyof typeof UniformNameProblem];
export type WorkspaceInvalidInputIssue =
  | {
      readonly kind: typeof WorkspaceInvalidInputKind.HistoryAdapter;
      readonly mode: HistoryMode;
      readonly adapterRequired: boolean;
    }
  | {
      readonly kind: typeof WorkspaceInvalidInputKind.UniformName;
      readonly problem: UniformNameProblem;
      readonly index?: number;
    }
  | {
      readonly kind: typeof WorkspaceInvalidInputKind.FileNameLength;
      readonly recordId: string;
      readonly limit: number;
      readonly utf8Bytes: number;
      readonly utf16Units: number;
    }
  | {
      readonly kind: typeof WorkspaceInvalidInputKind.TargetKind;
      readonly recordId: string;
      readonly expectedKind: string;
      readonly actualKind: RecordKind;
      readonly field?: string;
    }
  | {
      readonly kind: typeof WorkspaceInvalidInputKind.MetadataShape;
      readonly recordId: string;
      readonly recordKind: RecordKind;
    }
  | {
      readonly kind: typeof WorkspaceInvalidInputKind.ExternalKey;
      readonly gameId: string;
      readonly authority: string;
      readonly referenceKind: string;
    };
export class WorkspaceInvalidInputError extends Data.TaggedError("WorkspaceInvalidInputError")<{
  readonly issue: WorkspaceInvalidInputIssue;
  readonly message: string;
}> {}

export const WorkspaceResourceKind = {
  Record: "record",
  Game: "game",
  Host: "host",
  Installation: "installation",
  Source: "source",
  LaunchEntry: "launch-entry"
} as const;
export type WorkspaceResourceKind =
  (typeof WorkspaceResourceKind)[keyof typeof WorkspaceResourceKind];
export class WorkspaceNotFoundError extends Data.TaggedError("WorkspaceNotFoundError")<{
  readonly resource: WorkspaceResourceKind;
  readonly id: string;
  readonly referringRecordId?: string;
  readonly hostId?: string;
  readonly message: string;
}> {}

export const WorkspaceConflictKind = {
  DuplicateRecordId: "duplicate-record-id",
  ExternalIdentity: "external-identity",
  DuplicateSourceId: "duplicate-source-id",
  DuplicateLaunchEntryId: "duplicate-launch-entry-id",
  SettingsSetAndClear: "settings-set-and-clear",
  ReferencedSourceKind: "referenced-source-kind",
  ExternalChange: "external-change"
} as const;
export type WorkspaceConflictKind =
  (typeof WorkspaceConflictKind)[keyof typeof WorkspaceConflictKind];
export const SettingsClearField = {
  LaunchEntry: "launchEntry",
  PreferredAdapters: "preferredAdapters",
  AdapterOptions: "adapterOptions"
} as const;
export type SettingsClearField = (typeof SettingsClearField)[keyof typeof SettingsClearField];
export type WorkspaceConflictIssue =
  | {
      readonly kind: typeof WorkspaceConflictKind.ExternalIdentity;
      readonly recordIds: readonly string[];
      readonly issuer: string;
      readonly purpose: string;
      readonly value: string;
    }
  | { readonly kind: typeof WorkspaceConflictKind.DuplicateRecordId; readonly recordId: string }
  | {
      readonly kind: typeof WorkspaceConflictKind.DuplicateSourceId;
      readonly hostId: string;
      readonly sourceId: string;
    }
  | {
      readonly kind: typeof WorkspaceConflictKind.DuplicateLaunchEntryId;
      readonly installationId: string;
      readonly launchEntryId: string;
    }
  | {
      readonly kind: typeof WorkspaceConflictKind.SettingsSetAndClear;
      readonly field: SettingsClearField;
      readonly key?: string;
    }
  | {
      readonly kind: typeof WorkspaceConflictKind.ReferencedSourceKind;
      readonly hostId: string;
      readonly sourceId: string;
      readonly installationId: string;
      readonly expectedKind: string;
      readonly actualKind: string;
    }
  | {
      readonly kind: typeof WorkspaceConflictKind.ExternalChange;
      readonly path: string;
      readonly phase: string;
    };
export class WorkspaceConflictError extends Data.TaggedError("WorkspaceConflictError")<{
  readonly issue: WorkspaceConflictIssue;
  readonly message: string;
}> {}

export type WorkspaceRuleFailure =
  | SchemaValidationError
  | WorkspaceInvalidInputError
  | WorkspaceNotFoundError
  | WorkspaceConflictError;
export const isWorkspaceRuleFailure = (error: unknown): error is WorkspaceRuleFailure =>
  error instanceof SchemaValidationError ||
  error instanceof WorkspaceInvalidInputError ||
  error instanceof WorkspaceNotFoundError ||
  error instanceof WorkspaceConflictError;

// Only the public data protocol lives here; the implementation owns its native I/O class.
export interface WorkspaceFileSystemFailure extends Error {
  readonly _tag: "WorkspaceFileSystemError";
  readonly operation: string;
  readonly code?: string;
  readonly cause?: unknown;
}
export const ConfigurationInputKind = {
  Syntax: "syntax",
  JsonSubset: "json-subset",
  RecordSize: "record-size",
  Layout: "layout",
  UnsafePath: "unsafe-path",
  InvalidJournal: "invalid-journal",
  EditSemantics: "edit-semantics",
  Value: "value",
  Utf8: "utf8",
  Root: "root",
  Limit: "limit",
  Receipt: "receipt"
} as const;
export type ConfigurationInputKind =
  (typeof ConfigurationInputKind)[keyof typeof ConfigurationInputKind];
export const ConfigurationLayoutProblem = {
  NotDirectory: "not-directory",
  NotFile: "not-file",
  Link: "link",
  LegacyFormat: "legacy-format",
  InvalidFilename: "invalid-filename",
  RecordKindMismatch: "record-kind-mismatch",
  RecordIdentityMismatch: "record-identity-mismatch",
  HostContainerMismatch: "host-container-mismatch",
  DuplicateLayout: "duplicate-layout",
  UnexpectedEntry: "unexpected-entry"
} as const;
export type ConfigurationLayoutProblem =
  (typeof ConfigurationLayoutProblem)[keyof typeof ConfigurationLayoutProblem];
export const ConfigurationPathProblem = {
  Traversal: "traversal",
  Link: "link",
  ParentNotDirectory: "parent-not-directory"
} as const;
export type ConfigurationPathProblem =
  (typeof ConfigurationPathProblem)[keyof typeof ConfigurationPathProblem];
export const ConfigurationJournalProblem = {
  Shape: "shape",
  RecordKind: "record-kind",
  ManagedPath: "managed-path",
  RecordIdentity: "record-identity",
  RecordSemantics: "record-semantics",
  OperationId: "operation-id",
  Size: "size"
} as const;
export type ConfigurationJournalProblem =
  (typeof ConfigurationJournalProblem)[keyof typeof ConfigurationJournalProblem];
export const ConfigurationValueProblem = {
  UnsafeInteger: "unsafe-integer",
  NonFinite: "non-finite",
  DateTime: "date-time",
  TablePath: "table-path",
  Unsupported: "unsupported"
} as const;
export type ConfigurationValueProblem =
  (typeof ConfigurationValueProblem)[keyof typeof ConfigurationValueProblem];
export type ConfigurationInputIssue =
  | {
      readonly kind: typeof ConfigurationInputKind.Syntax;
      readonly format: string;
      readonly position?: {
        readonly line: number;
        readonly column: number;
        readonly offset?: number;
      };
    }
  | {
      readonly kind: typeof ConfigurationInputKind.JsonSubset;
      readonly problem: ConfigurationValueProblem;
    }
  | {
      readonly kind: typeof ConfigurationInputKind.RecordSize;
      readonly limit: number;
      readonly actual: number;
    }
  | {
      readonly kind: typeof ConfigurationInputKind.Layout;
      readonly path: string;
      readonly problem: ConfigurationLayoutProblem;
      readonly expected?: string;
      readonly actual?: string;
    }
  | {
      readonly kind: typeof ConfigurationInputKind.UnsafePath;
      readonly path: string;
      readonly problem: ConfigurationPathProblem;
    }
  | {
      readonly kind: typeof ConfigurationInputKind.InvalidJournal;
      readonly workflow: string;
      readonly problem: Exclude<
        ConfigurationJournalProblem,
        typeof ConfigurationJournalProblem.Size
      >;
    }
  | {
      readonly kind: typeof ConfigurationInputKind.InvalidJournal;
      readonly workflow: string;
      readonly problem: typeof ConfigurationJournalProblem.Size;
      readonly limit: number;
      readonly actual: number;
    }
  | { readonly kind: typeof ConfigurationInputKind.EditSemantics; readonly recordId?: string }
  | {
      readonly kind: typeof ConfigurationInputKind.Value;
      readonly format: string;
      readonly valueType: string;
    }
  | { readonly kind: typeof ConfigurationInputKind.Utf8; readonly path?: string }
  | { readonly kind: typeof ConfigurationInputKind.Root; readonly path: string }
  | {
      readonly kind: typeof ConfigurationInputKind.Limit;
      readonly subject: string;
      readonly limit: number;
      readonly actual: number;
    }
  | {
      readonly kind: typeof ConfigurationInputKind.Receipt;
      readonly workflow: string;
      readonly operationId: string;
    };
export interface ConfigurationInvalidInputFailure extends Error {
  readonly _tag: "ConfigurationInvalidInputError";
  readonly issue: ConfigurationInputIssue;
}
export interface WorkspaceWriterConflictFailure extends Error {
  readonly _tag: "WorkspaceWriterConflict";
}
export interface WorkspaceWriterRecoveryFailure extends Error {
  readonly _tag: "WorkspaceWriterRecoveryRequired";
  readonly cause?: unknown;
}
export type WorkspaceConfigurationError =
  | WorkspaceRuleFailure
  | WorkspaceFileSystemFailure
  | ConfigurationInvalidInputFailure
  | UnexpectedBoundaryError
  | WorkspaceWriterConflictFailure
  | WorkspaceWriterRecoveryFailure
  | LocationError;

export class ConfigurationHistoryError extends Data.TaggedError("ConfigurationHistoryError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}
