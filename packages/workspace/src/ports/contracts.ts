import { type Effect } from "effect";
import {
  type EditConfigurationInput,
  type EditConfigurationResult,
  type ImportConfigurationInput,
  type ImportConfigurationResult,
  type InitializeConfigurationInput,
  type InitializeConfigurationResult,
  type RecoverEditConfigurationInput,
  type RecoverImportConfigurationInput,
  type RecoverInitializeConfigurationInput,
  type RenameConfigurationInput,
  type RenameConfigurationResult
} from "../model/edits.ts";
import {
  type ConfigurationHistoryError,
  type WorkspaceConfigurationError
} from "../model/errors.ts";
import { type WorkspaceSnapshot } from "../model/records.ts";
import { type HistoryRecordStatus } from "../model/vocabulary.ts";

export interface WorkspaceConfigurationPort {
  read(input: { root: string }): Effect.Effect<WorkspaceSnapshot, WorkspaceConfigurationError>;
  initialize?(
    input: InitializeConfigurationInput
  ): Effect.Effect<InitializeConfigurationResult, WorkspaceConfigurationError>;
  recoverInitialize?(
    input: RecoverInitializeConfigurationInput
  ): Effect.Effect<InitializeConfigurationResult, WorkspaceConfigurationError>;
  edit?(
    input: EditConfigurationInput
  ): Effect.Effect<EditConfigurationResult, WorkspaceConfigurationError>;
  recoverEdit?(
    input: RecoverEditConfigurationInput
  ): Effect.Effect<EditConfigurationResult, WorkspaceConfigurationError>;
  rename?(
    input: RenameConfigurationInput
  ): Effect.Effect<RenameConfigurationResult, WorkspaceConfigurationError>;
  import?(
    input: ImportConfigurationInput
  ): Effect.Effect<ImportConfigurationResult, WorkspaceConfigurationError>;
  recoverImport?(
    input: RecoverImportConfigurationInput
  ): Effect.Effect<ImportConfigurationResult, WorkspaceConfigurationError>;
}

// Operations belong to the Port; support and capabilities belong to AdapterDescriptor.
export interface ConfigurationHistoryPort {
  list(input: { cursor?: string; limit: number }): Effect.Effect<
    {
      head: string | null;
      entries: { id: string; summary: string; createdAt: string }[];
      nextCursor?: string;
    },
    ConfigurationHistoryError
  >;
  findOperation(
    operationId: string
  ): Effect.Effect<{ id: string } | null, ConfigurationHistoryError>;
  read(input: { id: string }): Effect.Effect<
    {
      id: string;
      records: { path: string; content: string }[];
    },
    ConfigurationHistoryError
  >;
  record(input: {
    operationId: string;
    expectedHead: string | null;
    summary: string;
    changes: {
      path: string;
      beforeHash: string | null;
      content: string | null;
    }[];
  }): Effect.Effect<
    | { status: typeof HistoryRecordStatus.Recorded; id: string }
    | { status: typeof HistoryRecordStatus.Conflict; actualHead: string | null }
    | { status: typeof HistoryRecordStatus.Failed; reason: string }
    | { status: typeof HistoryRecordStatus.Unknown; reason: string },
    ConfigurationHistoryError
  >;
}
