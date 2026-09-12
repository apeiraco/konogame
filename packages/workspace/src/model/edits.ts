import { assertSchema, configurationValueSchema } from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import {
  isWorkspaceRuleFailure,
  WorkspaceConflictError,
  WorkspaceConflictKind,
  WorkspaceInvalidInputError,
  WorkspaceInvalidInputKind,
  WorkspaceNotFoundError,
  WorkspaceResourceKind
} from "./errors.ts";
import {
  assertConfigurationRecord,
  type ConfigurationRecord,
  type GameRecord,
  gameSchema,
  type HostRecord,
  hostSchema,
  type InstallationRecord,
  installationSchema,
  recordFileKey,
  settingsSchema,
  text,
  textRecord,
  uuidSchema,
  validateRelationships,
  type WorkspaceRecord,
  type WorkspaceSnapshot,
  workspaceSchema
} from "./records.ts";
import {
  ConfigurationEditKind,
  type EditStatus,
  HistoryMode,
  type ImportStatus,
  type InitializeStatus,
  RecordKind,
  type RenameStatus,
  SettingsTargetKind
} from "./vocabulary.ts";

// Edit intents and differences are value objects; the records they address are UUID entities.
export const configurationEditChangeSchema = type
  .or(
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.MetadataReplace),
      target: type({
        "+": "reject",
        kind: type.unit(RecordKind.Workspace),
        recordId: uuidSchema
      }),
      metadata: type({ "+": "reject", name: text })
    }),
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.MetadataReplace),
      target: type({
        "+": "reject",
        kind: type.unit(RecordKind.Game),
        recordId: uuidSchema
      }),
      metadata: type({ "+": "reject", title: text, "edition?": text })
    }),
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.MetadataReplace),
      target: type({
        "+": "reject",
        kind: type.unit(RecordKind.Host),
        recordId: uuidSchema
      }),
      metadata: type({ "+": "reject", label: text })
    }),
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.SettingsReplace),
      target: type.or(
        type({
          "+": "reject",
          kind: type.enumerated(
            SettingsTargetKind.Workspace,
            SettingsTargetKind.Game,
            SettingsTargetKind.Host,
            SettingsTargetKind.Installation
          ),
          recordId: uuidSchema
        }),
        type({
          "+": "reject",
          kind: type.unit(SettingsTargetKind.HostGame),
          recordId: uuidSchema,
          gameId: uuidSchema
        })
      ),
      settings: settingsSchema
    }),
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.HostCreate),
      host: hostSchema
    }),
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.HostRootsReplace),
      hostId: uuidSchema,
      roots: textRecord
    }),
    type({
      "+": "reject",
      kind: type.unit(ConfigurationEditKind.HostSourcesReplace),
      hostId: uuidSchema,
      sources: hostSchema.get("sources")
    })
  )
  .onDeepUndeclaredKey("reject");
export type ConfigurationEditChange = (typeof configurationEditChangeSchema)["infer"];

export const initializeConfigurationInputSchema = type({
  "+": "reject",
  root: text,
  operationId: uuidSchema,
  workspace: workspaceSchema,
  host: hostSchema
})
  .narrow((input, ctx) => {
    if (
      input.workspace.id === input.host.id ||
      input.workspace.history.mode !== HistoryMode.Disabled ||
      Object.keys(input.host.gameOverrides).length > 0
    ) {
      return ctx.mustBe(
        "distinct Workspace and Host identities, disabled history and no initial game overrides"
      );
    }
    try {
      validateRelationships({
        workspace: input.workspace,
        hosts: [input.host],
        games: [],
        installations: [],
        revision: "initial"
      });
      recordFileKey(input.host.id, input.host.uniformName, ".toml");
      return true;
    } catch (error) {
      if (!isWorkspaceRuleFailure(error)) {
        throw error;
      }
      return ctx.mustBe(error.message);
    }
  })
  .onDeepUndeclaredKey("reject");
export type InitializeConfigurationInput = (typeof initializeConfigurationInputSchema)["infer"];
export const recoverInitializeConfigurationInputSchema = type({
  "+": "reject",
  root: text,
  operationId: uuidSchema
}).onDeepUndeclaredKey("reject");
export type RecoverInitializeConfigurationInput =
  (typeof recoverInitializeConfigurationInputSchema)["infer"];
export interface InitializeConfigurationResult {
  status: InitializeStatus;
  operationId: string;
  revision?: string;
  workspaceId?: string;
  hostId?: string;
  reason?: string;
}
export const editConfigurationInputSchema = type({
  "+": "reject",
  root: text,
  operationId: uuidSchema,
  expectedRevision: text,
  change: configurationEditChangeSchema
}).onDeepUndeclaredKey("reject");
export type EditConfigurationInput = (typeof editConfigurationInputSchema)["infer"];
export const recoverEditConfigurationInputSchema = type({
  "+": "reject",
  root: text,
  operationId: uuidSchema
}).onDeepUndeclaredKey("reject");
export type RecoverEditConfigurationInput = (typeof recoverEditConfigurationInputSchema)["infer"];
export interface EditConfigurationResult {
  status: EditStatus;
  operationId: string;
  revision?: string;
  recordId?: string;
  reason?: string;
}
export const configurationEditDifferenceSchema = type({
  "+": "reject",
  field: text,
  "before?": configurationValueSchema,
  "after?": configurationValueSchema
}).onDeepUndeclaredKey("reject");
export type ConfigurationEditDifference = (typeof configurationEditDifferenceSchema)["infer"];
export interface ConfigurationEditPlan {
  before?: ConfigurationRecord;
  after: ConfigurationRecord;
  differences: ConfigurationEditDifference[];
}

export const recoverImportConfigurationInputSchema = type({
  "+": "reject",
  root: text,
  operationId: uuidSchema
}).onDeepUndeclaredKey("reject");
export type RecoverImportConfigurationInput =
  (typeof recoverImportConfigurationInputSchema)["infer"];

export const importConfigurationInputSchema = type({
  "+": "reject",
  root: text,
  expectedRevision: text,
  operationId: uuidSchema,
  games: gameSchema.array(),
  installations: installationSchema.array()
}).onDeepUndeclaredKey("reject");
export type ImportConfigurationInput = (typeof importConfigurationInputSchema)["infer"];
export interface ImportConfigurationResult {
  status: ImportStatus;
  operationId: string;
  revision?: string;
  gameIds?: string[];
  installationIds?: string[];
  reason?: string;
}

export interface RenameConfigurationInput {
  root: string;
  recordId: string;
  uniformName: string;
  expectedRevision: string;
  operationId: string;
}
export interface RenameConfigurationResult {
  status: RenameStatus;
  operationId: string;
  revision?: string;
  paths?: { from: string; to: string }[];
  reason?: string;
}

function sameEditableValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (typeof left !== "object" || left === null || typeof right !== "object" || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameEditableValue(value, right[index]))
    );
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        sameEditableValue(Reflect.get(left, key), Reflect.get(right, key))
    )
  );
}

// Only editable fields are compared. Location resource equivalence always belongs to its Port.
export function applyConfigurationEdit(
  snapshot: WorkspaceSnapshot,
  untrustedChange: ConfigurationEditChange
): ConfigurationEditPlan {
  const change = assertSchema(
    "workspace.edit-change",
    configurationEditChangeSchema,
    untrustedChange
  );
  validateRelationships(snapshot);
  const all: ConfigurationRecord[] = [
    snapshot.workspace,
    ...snapshot.games,
    ...snapshot.hosts,
    ...snapshot.installations
  ];
  let before: ConfigurationRecord | undefined;
  let after: ConfigurationRecord;
  let fields: string[];
  if (change.kind === ConfigurationEditKind.HostCreate) {
    if (all.some((record) => record.id === change.host.id)) {
      throw new WorkspaceConflictError({
        issue: { kind: WorkspaceConflictKind.DuplicateRecordId, recordId: change.host.id },
        message: `Duplicate record ID: ${change.host.id}`
      });
    }
    after = change.host;
    recordFileKey(after.id, after.uniformName, ".toml");
    fields = Object.keys(after);
  } else {
    const recordId = "target" in change ? change.target.recordId : change.hostId;
    before = all.find((record) => record.id === recordId);
    if (!before) {
      throw new WorkspaceNotFoundError({
        resource: WorkspaceResourceKind.Record,
        id: recordId,
        message: `Unknown record: ${recordId}`
      });
    }
    if (change.kind === ConfigurationEditKind.MetadataReplace) {
      if (before.kind !== change.target.kind) {
        throw new WorkspaceInvalidInputError({
          issue: {
            kind: WorkspaceInvalidInputKind.TargetKind,
            recordId,
            expectedKind: change.target.kind,
            actualKind: before.kind,
            field: "metadata"
          },
          message: "Metadata target kind does not match record"
        });
      }
      if (before.kind === RecordKind.Game && "title" in change.metadata) {
        const { edition: _edition, ...rest } = before;
        after = { ...rest, ...change.metadata };
        fields = ["title", "edition"];
      } else if (before.kind === RecordKind.Workspace && "name" in change.metadata) {
        after = { ...before, name: change.metadata.name };
        fields = ["name"];
      } else if (before.kind === RecordKind.Host && "label" in change.metadata) {
        after = { ...before, label: change.metadata.label };
        fields = ["label"];
      } else {
        throw new WorkspaceInvalidInputError({
          issue: {
            kind: WorkspaceInvalidInputKind.MetadataShape,
            recordId,
            recordKind: before.kind
          },
          message: "Metadata does not match target kind"
        });
      }
    } else if (change.kind === ConfigurationEditKind.SettingsReplace) {
      if (change.target.kind === SettingsTargetKind.HostGame) {
        if (before.kind !== RecordKind.Host) {
          throw new WorkspaceInvalidInputError({
            issue: {
              kind: WorkspaceInvalidInputKind.TargetKind,
              recordId,
              expectedKind: RecordKind.Host,
              actualKind: before.kind,
              field: "gameOverrides"
            },
            message: "Host/Game settings require a Host"
          });
        }
        const gameId = change.target.gameId;
        if (!snapshot.games.some((game) => game.id === gameId)) {
          throw new WorkspaceNotFoundError({
            resource: WorkspaceResourceKind.Game,
            id: gameId,
            referringRecordId: recordId,
            message: `Unknown game: ${gameId}`
          });
        }
        const gameOverrides = { ...before.gameOverrides };
        if (Object.keys(change.settings).length) {
          gameOverrides[change.target.gameId] = change.settings;
        } else {
          delete gameOverrides[change.target.gameId];
        }
        after = { ...before, gameOverrides };
        fields = ["gameOverrides"];
      } else {
        if (before.kind !== change.target.kind) {
          throw new WorkspaceInvalidInputError({
            issue: {
              kind: WorkspaceInvalidInputKind.TargetKind,
              recordId,
              expectedKind: change.target.kind,
              actualKind: before.kind,
              field: "settings"
            },
            message: "Settings target kind does not match record"
          });
        }
        if (before.kind === RecordKind.Host || before.kind === RecordKind.Workspace) {
          after = { ...before, defaults: change.settings };
          fields = ["defaults"];
        } else {
          after = { ...before, settings: change.settings };
          fields = ["settings"];
        }
      }
    } else {
      if (before.kind !== RecordKind.Host) {
        throw new WorkspaceInvalidInputError({
          issue: {
            kind: WorkspaceInvalidInputKind.TargetKind,
            recordId,
            expectedKind: RecordKind.Host,
            actualKind: before.kind
          },
          message: "Host maintenance requires a Host"
        });
      }
      if (change.kind === ConfigurationEditKind.HostRootsReplace) {
        after = { ...before, roots: change.roots };
        fields = ["roots"];
      } else {
        for (const installation of snapshot.installations) {
          if (installation.hostId !== before.id) {
            continue;
          }
          const previous = before.sources.find((source) => source.id === installation.sourceId);
          const next = change.sources.find((source) => source.id === installation.sourceId);
          if (previous && next && previous.kind !== next.kind) {
            throw new WorkspaceConflictError({
              issue: {
                kind: WorkspaceConflictKind.ReferencedSourceKind,
                hostId: before.id,
                sourceId: installation.sourceId,
                installationId: installation.id,
                expectedKind: previous.kind,
                actualKind: next.kind
              },
              message: `Cannot change kind of referenced source: ${installation.sourceId}`
            });
          }
        }
        after = { ...before, sources: change.sources };
        fields = ["sources"];
      }
    }
  }
  assertConfigurationRecord(after);
  const updated = all.filter((record) => record.id !== after.id).concat(after);
  validateRelationships({
    workspace: updated.find((record) => record.kind === RecordKind.Workspace) as WorkspaceRecord,
    games: updated.filter((record): record is GameRecord => record.kind === RecordKind.Game),
    hosts: updated.filter((record): record is HostRecord => record.kind === RecordKind.Host),
    installations: updated.filter(
      (record): record is InstallationRecord => record.kind === RecordKind.Installation
    ),
    revision: snapshot.revision
  });
  const differences: ConfigurationEditDifference[] = [];
  for (const field of fields) {
    const previous = before ? Reflect.get(before, field) : undefined;
    const next = Reflect.get(after, field);
    if (sameEditableValue(previous, next)) {
      continue;
    }
    differences.push({
      field,
      ...(previous === undefined ? {} : { before: previous }),
      ...(next === undefined ? {} : { after: next })
    });
  }
  return { ...(before ? { before } : {}), after, differences };
}
