import {
  assertSchema,
  configurationValueSchema,
  DECLARATION_PROTOCOL_RANGE,
  type JsonSchema,
  locationContractSchema,
  type ModuleDescriptor
} from "@konogame/infrastructure/contracts";
import { type Type, type } from "arktype";
import { WORKSPACE_CONFIGURATION_PORT, WORKSPACE_HISTORY_PORT } from "../version.ts";
import {
  UniformNameProblem,
  WorkspaceConflictError,
  WorkspaceConflictKind,
  WorkspaceInvalidInputError,
  WorkspaceInvalidInputKind,
  WorkspaceNotFoundError,
  WorkspaceResourceKind
} from "./errors.ts";
import {
  HistoryMode,
  HostPlatform,
  LaunchKind,
  RecordKind,
  SourceStatus,
  WorkspaceCapability,
  WorkspaceFeature,
  WorkspaceOperation,
  WorkspacePort
} from "./vocabulary.ts";

export {
  type ConfigurationValue,
  configurationValueSchema
} from "@konogame/infrastructure/contracts";

export const WORKSPACE_SCHEMA = "workspace.experimental.4";
export const FILENAME_CODEC = "unicode-fs-v1";
// Recovery retries may use this sentinel; it never authorizes a new write.
export const RECOVERY_ONLY_REVISION = "recovery-only";
export const text = type.string.atLeastLength(1);
export const token = type.string.matching(/^[a-z][a-z0-9.-]*$/);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const uuidSchema = type.string.matching(uuidPattern);
const tokenRecord = type({ "+": "reject", "[/^[a-z][a-z0-9.-]*$/]": text });
const configurationRecord = type({
  "+": "reject",
  "[string]": configurationValueSchema
});
export const textRecord = type({ "+": "reject", "[/.+/]": text });
const envelope = { schemaVersion: type.unit(WORKSPACE_SCHEMA), id: uuidSchema };
// Exact strings, not units. A unit discriminant makes toJsonSchema drop object structure
// once a branch contains the configuration-value schema.
const recordKind = (kind: RecordKind) => type.string.matching(new RegExp(`^${kind}$`));
export const settingsSchema = type({
  "+": "reject",
  "preferredAdapters?": tokenRecord,
  "launchEntry?": token,
  "arguments?": type.string.array(),
  "adapterOptions?": type({
    "+": "reject",
    "[/^[a-z][a-z0-9.-]*$/]": configurationRecord
  }),
  "clear?": type({
    "+": "reject",
    "launchEntry?": type.unit(true),
    "preferredAdapters?": token.array(),
    "adapterOptions?": token.array()
  })
});
type SettingsLayer = (typeof settingsSchema)["infer"];
const gameOverridesSchema = type({
  "+": "reject",
  "[/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/]": settingsSchema
}) as Type<Record<string, SettingsLayer>>;

export const ExternalIdentityPurpose = {
  Game: "game",
  Installation: "installation"
} as const;
export type ExternalIdentityPurpose =
  (typeof ExternalIdentityPurpose)[keyof typeof ExternalIdentityPurpose];
export const externalIdentitySchema = type({
  "+": "reject",
  issuer: token,
  purpose: type.enumerated(ExternalIdentityPurpose.Game, ExternalIdentityPurpose.Installation),
  value: text
});
export type ExternalIdentity = (typeof externalIdentitySchema)["infer"];
const identitiesFor = (purpose: ExternalIdentityPurpose) =>
  externalIdentitySchema.and({ purpose: type.unit(purpose) }).array();

const externalRefSchema = type({
  "+": "reject",
  authority: token,
  kind: token,
  key: textRecord
});
const historySchema = type({
  "+": "reject",
  mode: type.enumerated(HistoryMode.Disabled, HistoryMode.Adapter),
  "adapterId?": text
});

const workspaceSchemaValue = type({
  "+": "reject",
  ...envelope,
  kind: recordKind(RecordKind.Workspace),
  name: text,
  defaults: settingsSchema,
  history: historySchema
});

const gameSchemaValue = type({
  "+": "reject",
  ...envelope,
  kind: recordKind(RecordKind.Game),
  uniformName: text,
  title: text,
  "edition?": text,
  externalRefs: externalRefSchema.array(),
  "externalIdentities?": identitiesFor(ExternalIdentityPurpose.Game),
  settings: settingsSchema
});

const hostSchemaValue = type({
  "+": "reject",
  ...envelope,
  kind: recordKind(RecordKind.Host),
  uniformName: text,
  label: text,
  platform: type.enumerated(HostPlatform.Windows, HostPlatform.Linux, HostPlatform.MacOS),
  roots: textRecord,
  defaults: settingsSchema,
  gameOverrides: gameOverridesSchema,
  sources: type({
    "+": "reject",
    id: token,
    kind: token,
    status: type.enumerated(SourceStatus.Planned, SourceStatus.Configured)
  }).array()
});

const installationSchemaValue = type({
  "+": "reject",
  ...envelope,
  kind: recordKind(RecordKind.Installation),
  uniformName: text,
  gameId: uuidSchema,
  hostId: uuidSchema,
  sourceId: token,
  location: locationContractSchema,
  "externalIdentities?": identitiesFor(ExternalIdentityPurpose.Installation),
  launchEntries: type({
    "+": "reject",
    id: token,
    label: text,
    kind: type.enumerated(LaunchKind.Executable, LaunchKind.Uri, LaunchKind.Managed),
    target: text,
    arguments: type.string.array()
  }).array(),
  settings: settingsSchema
});

type HistorySetting =
  | { mode: typeof HistoryMode.Disabled }
  | { mode: typeof HistoryMode.Adapter; adapterId: string };
export type Settings = (typeof settingsSchema)["infer"];
export type WorkspaceRecord = Omit<(typeof workspaceSchemaValue)["infer"], "kind" | "history"> & {
  kind: typeof RecordKind.Workspace;
  history: HistorySetting;
};
export type GameRecord = Omit<(typeof gameSchemaValue)["infer"], "kind"> & {
  kind: typeof RecordKind.Game;
};
export type HostRecord = Omit<(typeof hostSchemaValue)["infer"], "kind"> & {
  kind: typeof RecordKind.Host;
};
export type InstallationRecord = Omit<(typeof installationSchemaValue)["infer"], "kind"> & {
  kind: typeof RecordKind.Installation;
};
export type ConfigurationRecord = WorkspaceRecord | GameRecord | HostRecord | InstallationRecord;
export const workspaceSchema = workspaceSchemaValue as unknown as Type<WorkspaceRecord>;
export const gameSchema = gameSchemaValue as unknown as Type<GameRecord>;
export const hostSchema = hostSchemaValue as unknown as Type<HostRecord>;
export const installationSchema = installationSchemaValue as unknown as Type<InstallationRecord>;
export const recordSchema = type.or(
  workspaceSchemaValue,
  gameSchemaValue,
  hostSchemaValue,
  installationSchemaValue
) as unknown as Type<ConfigurationRecord>;

function assertWorkspaceHistory(history: HistorySetting): void {
  if (history.mode === HistoryMode.Disabled && "adapterId" in history) {
    throw new WorkspaceInvalidInputError({
      issue: {
        kind: WorkspaceInvalidInputKind.HistoryAdapter,
        mode: history.mode,
        adapterRequired: false
      },
      message: "Disabled history cannot declare an adapter ID"
    });
  }
  if (history.mode === HistoryMode.Adapter && !("adapterId" in history)) {
    throw new WorkspaceInvalidInputError({
      issue: {
        kind: WorkspaceInvalidInputKind.HistoryAdapter,
        mode: HistoryMode.Adapter,
        adapterRequired: true
      },
      message: "Adapter history requires an adapter ID"
    });
  }
}

export function assertConfigurationRecord(value: unknown): ConfigurationRecord {
  const record = assertSchema("workspace.record", recordSchema, value);
  if (record.kind === RecordKind.Workspace) {
    assertWorkspaceHistory(record.history);
  }
  return record;
}

// TOML tables are null-prototype objects. Copy them to ordinary objects before validation.
export function materializeRecord(value: unknown): unknown {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeRecord(item));
  }
  const copy = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: materializeRecord((value as Record<string, unknown>)[key])
    });
  }
  return copy;
}

export function workspaceJsonSchema(): JsonSchema {
  return recordSchema.toJsonSchema({ target: "draft-2020-12" });
}

export interface WorkspaceSnapshot {
  workspace: WorkspaceRecord;
  games: GameRecord[];
  hosts: HostRecord[];
  installations: InstallationRecord[];
  revision: string;
  diagnostics?: { path: string; message: string }[];
}

export const workspaceModule: ModuleDescriptor = {
  id: "konogame.workspace",
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  features: [
    {
      id: WorkspaceFeature.Initialize,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.Initialize,
      requiredCapabilities: [WorkspaceCapability.Initialize]
    },
    {
      id: WorkspaceFeature.RecoverInitialize,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.RecoverInitialize,
      requiredCapabilities: [WorkspaceCapability.InitializeRecovery]
    },
    {
      id: WorkspaceFeature.Edit,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.Edit,
      requiredCapabilities: [WorkspaceCapability.Edit]
    },
    {
      id: WorkspaceFeature.RecoverEdit,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.RecoverEdit,
      requiredCapabilities: [WorkspaceCapability.EditRecovery]
    },
    {
      id: WorkspaceFeature.Inspect,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.Read,
      requiredCapabilities: [WorkspaceCapability.Records]
    },
    {
      id: WorkspaceFeature.Rename,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.Rename,
      requiredCapabilities: [WorkspaceCapability.Rename]
    },
    {
      id: WorkspaceFeature.Import,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.Import,
      requiredCapabilities: [WorkspaceCapability.Import]
    },
    {
      id: WorkspaceFeature.RecoverImport,
      port: WorkspacePort.Configuration,
      portVersion: WORKSPACE_CONFIGURATION_PORT.version,
      operation: WorkspaceOperation.RecoverImport,
      requiredCapabilities: [WorkspaceCapability.ImportRecovery]
    },
    {
      id: WorkspaceFeature.History,
      port: WorkspacePort.History,
      portVersion: WORKSPACE_HISTORY_PORT.version,
      operation: WorkspaceOperation.List,
      requiredCapabilities: [WorkspaceCapability.VersionedHistory]
    }
  ]
};

export function encodeUniformName(value: string): string {
  if (!value) {
    throw new WorkspaceInvalidInputError({
      issue: { kind: WorkspaceInvalidInputKind.UniformName, problem: UniformNameProblem.Empty },
      message: "uniformName must not be empty"
    });
  }
  const normalized = value.normalize("NFC");
  let encoded = "";
  for (let index = 0; index < normalized.length; ) {
    const point = normalized.codePointAt(index)!;
    const character = String.fromCodePoint(point);
    if (point >= 0xd800 && point <= 0xdfff) {
      throw new WorkspaceInvalidInputError({
        issue: {
          kind: WorkspaceInvalidInputKind.UniformName,
          problem: UniformNameProblem.UnpairedSurrogate,
          index
        },
        message: "uniformName contains an unpaired surrogate"
      });
    }
    const trailing = /^[ .]+$/.test(normalized.slice(index));
    if (
      point < 32 ||
      (point >= 127 && point <= 159) ||
      /[%<>:"/\\|?*]/.test(character) ||
      (trailing && /[ .]/.test(character))
    ) {
      encoded += Array.from(
        new TextEncoder().encode(character),
        (byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`
      ).join("");
    } else {
      encoded += character;
    }
    index += character.length;
  }
  return encoded;
}

export function recordFileKey(id: string, uniformName: string, suffix = ""): string {
  assertSchema("workspace.uuid", uuidSchema, id);
  const key = `${id}-${encodeUniformName(uniformName)}${suffix}`;
  if (key.length > 255 || new TextEncoder().encode(key).length > 255) {
    throw new WorkspaceInvalidInputError({
      issue: {
        kind: WorkspaceInvalidInputKind.FileNameLength,
        recordId: id,
        limit: 255,
        utf8Bytes: new TextEncoder().encode(key).length,
        utf16Units: key.length
      },
      message: "Record filename exceeds 255 UTF-8 bytes or UTF-16 units"
    });
  }
  return key;
}

export function validateRelationships(snapshot: WorkspaceSnapshot): void {
  assertWorkspaceHistory(snapshot.workspace.history);
  const ids = new Set<string>();
  for (const record of [
    snapshot.workspace,
    ...snapshot.games,
    ...snapshot.hosts,
    ...snapshot.installations
  ]) {
    if (ids.has(record.id)) {
      throw new WorkspaceConflictError({
        issue: { kind: WorkspaceConflictKind.DuplicateRecordId, recordId: record.id },
        message: `Duplicate record ID: ${record.id}`
      });
    }
    ids.add(record.id);
  }
  const externalIdentities = new Map<string, string>();
  for (const record of [...snapshot.games, ...snapshot.installations]) {
    const issuers = new Set<string>();
    for (const identity of record.externalIdentities ?? []) {
      const key = JSON.stringify([identity.issuer, identity.purpose, identity.value]);
      const issuerKey = JSON.stringify([identity.issuer, identity.purpose]);
      const previous = externalIdentities.get(key);
      if (previous || issuers.has(issuerKey)) {
        throw new WorkspaceConflictError({
          issue: {
            kind: WorkspaceConflictKind.ExternalIdentity,
            recordIds: previous ? [previous, record.id] : [record.id],
            ...identity
          },
          message: "External identity conflicts with another record or identity"
        });
      }
      externalIdentities.set(key, record.id);
      issuers.add(issuerKey);
    }
  }
  const games = new Map(snapshot.games.map((game) => [game.id, game]));
  const hosts = new Map(snapshot.hosts.map((host) => [host.id, host]));
  const duplicate = (items: string[]) => items.find((item, index) => items.indexOf(item) !== index);
  for (const game of snapshot.games) {
    for (const ref of game.externalRefs) {
      if (!Object.keys(ref.key).length) {
        throw new WorkspaceInvalidInputError({
          issue: {
            kind: WorkspaceInvalidInputKind.ExternalKey,
            gameId: game.id,
            authority: ref.authority,
            referenceKind: ref.kind
          },
          message: `Empty external key: ${game.id}`
        });
      }
    }
  }
  for (const host of snapshot.hosts) {
    const sourceId = duplicate(host.sources.map((source) => source.id));
    if (sourceId !== undefined) {
      throw new WorkspaceConflictError({
        issue: { kind: WorkspaceConflictKind.DuplicateSourceId, hostId: host.id, sourceId },
        message: `Duplicate source ID in host ${host.id}`
      });
    }
    for (const gameId of Object.keys(host.gameOverrides)) {
      if (!games.has(gameId)) {
        throw new WorkspaceNotFoundError({
          resource: WorkspaceResourceKind.Game,
          id: gameId,
          referringRecordId: host.id,
          hostId: host.id,
          message: `Unknown game override: ${gameId}`
        });
      }
    }
  }
  for (const installation of snapshot.installations) {
    if (!games.has(installation.gameId)) {
      throw new WorkspaceNotFoundError({
        resource: WorkspaceResourceKind.Game,
        id: installation.gameId,
        referringRecordId: installation.id,
        message: `Unknown game: ${installation.gameId}`
      });
    }
    const host = hosts.get(installation.hostId);
    if (!host) {
      throw new WorkspaceNotFoundError({
        resource: WorkspaceResourceKind.Host,
        id: installation.hostId,
        referringRecordId: installation.id,
        message: `Unknown host: ${installation.hostId}`
      });
    }
    assertSchema("workspace.location", locationContractSchema, installation.location);
    if (!host.sources.some((source) => source.id === installation.sourceId)) {
      throw new WorkspaceNotFoundError({
        resource: WorkspaceResourceKind.Source,
        id: installation.sourceId,
        referringRecordId: installation.id,
        hostId: host.id,
        message: `Unknown source: ${installation.sourceId}`
      });
    }
    const launchEntryId = duplicate(installation.launchEntries.map((entry) => entry.id));
    if (launchEntryId !== undefined) {
      throw new WorkspaceConflictError({
        issue: {
          kind: WorkspaceConflictKind.DuplicateLaunchEntryId,
          installationId: installation.id,
          launchEntryId
        },
        message: `Duplicate launch entry in ${installation.id}`
      });
    }
  }
}
