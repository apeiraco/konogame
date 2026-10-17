import { posix, win32 } from "node:path";
import { CORE_CONTRACT_RANGE, type ModuleDescriptor } from "@konogame/contracts";
import * as z from "zod";
import {
  HistoryMode,
  type HistoryRecordStatus,
  HostPlatform,
  LaunchKind,
  LocationKind,
  RecordKind,
  type RenameStatus,
  SourceStatus,
  WorkspaceCapability,
  WorkspaceFeature,
  WorkspaceOperation,
  WorkspacePort
} from "./vocabulary.ts";

export * from "./vocabulary.ts";

export const WORKSPACE_SCHEMA = "workspace.experimental.3";
export const FILENAME_CODEC = "unicode-fs-v1";
// Recovery retries may use this sentinel; it never authorizes a new write.
export const RECOVERY_ONLY_REVISION = "recovery-only";
const text = z.string().min(1);
const token = z.string().regex(/^[a-z][a-z0-9.-]*$/);
export const uuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const uuid = uuidSchema;
const envelope = { schemaVersion: z.literal(WORKSPACE_SCHEMA), id: uuid };
export type ConfigurationValue =
  | string
  | number
  | boolean
  | ConfigurationValue[]
  | { [key: string]: ConfigurationValue };
const configurationNumberSchema = z
  .number()
  .refine(
    (value) => Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value)),
    "Expected a finite JSON number with safe integers"
  );
export const configurationValueSchema: z.ZodType<ConfigurationValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.boolean(),
    configurationNumberSchema,
    z.array(configurationValueSchema),
    z.record(z.string(), configurationValueSchema)
  ])
);

export const settingsSchema = z
  .strictObject({
    preferredAdapters: z.record(token, text).optional(),
    launchEntry: token.optional(),
    arguments: z.array(z.string()).optional(),
    adapterOptions: z.record(token, z.record(z.string(), configurationValueSchema)).optional(),
    clear: z
      .strictObject({
        launchEntry: z.literal(true).optional(),
        preferredAdapters: z.array(token).optional(),
        adapterOptions: z.array(token).optional()
      })
      .optional()
  })
  .superRefine((settings, ctx) => {
    if (settings.clear?.launchEntry && settings.launchEntry !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "Cannot set and clear launchEntry in the same layer"
      });
    for (const field of ["preferredAdapters", "adapterOptions"] as const) {
      for (const key of settings.clear?.[field] ?? [])
        if (Object.hasOwn(settings[field] ?? {}, key))
          ctx.addIssue({
            code: "custom",
            message: `Cannot set and clear ${field}.${key} in the same layer`
          });
    }
  });

const externalRefSchema = z.strictObject({
  authority: token,
  kind: token,
  key: z.record(text, text)
});

export const workspaceSchema = z.strictObject({
  ...envelope,
  kind: z.literal(RecordKind.Workspace),
  name: text,
  defaults: settingsSchema,
  history: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal(HistoryMode.Disabled) }),
    z.strictObject({ mode: z.literal(HistoryMode.Adapter), adapterId: text })
  ])
});

export const gameSchema = z.strictObject({
  ...envelope,
  kind: z.literal(RecordKind.Game),
  uniformName: text,
  title: text,
  edition: text.optional(),
  externalRefs: z.array(externalRefSchema),
  settings: settingsSchema
});

export const hostSchema = z.strictObject({
  ...envelope,
  kind: z.literal(RecordKind.Host),
  uniformName: text,
  label: text,
  platform: z.literal(Object.values(HostPlatform)),
  roots: z.record(text, text),
  defaults: settingsSchema,
  gameOverrides: z.record(uuid, settingsSchema),
  sources: z.array(
    z.strictObject({
      id: token,
      kind: token,
      status: z.literal(Object.values(SourceStatus))
    })
  )
});

export const installationSchema = z.strictObject({
  ...envelope,
  kind: z.literal(RecordKind.Installation),
  uniformName: text,
  gameId: uuid,
  hostId: uuid,
  sourceId: token,
  location: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal(LocationKind.Absolute), path: text }),
    z.strictObject({ kind: z.literal(LocationKind.Relative), rootKey: text, path: text }),
    z.strictObject({ kind: z.literal(LocationKind.Managed), reference: externalRefSchema })
  ]),
  launchEntries: z.array(
    z.strictObject({
      id: token,
      label: text,
      kind: z.literal(Object.values(LaunchKind)),
      target: text,
      arguments: z.array(z.string())
    })
  ),
  settings: settingsSchema
});

export const recordSchema = z.discriminatedUnion("kind", [
  workspaceSchema,
  gameSchema,
  hostSchema,
  installationSchema
]);
export type Settings = z.infer<typeof settingsSchema>;
export type WorkspaceRecord = z.infer<typeof workspaceSchema>;
export type GameRecord = z.infer<typeof gameSchema>;
export type HostRecord = z.infer<typeof hostSchema>;
export type InstallationRecord = z.infer<typeof installationSchema>;
export type ConfigurationRecord = z.infer<typeof recordSchema>;

export function workspaceJsonSchema(): object {
  return z.toJSONSchema(recordSchema, {
    target: "draft-2020-12",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema === configurationNumberSchema)
        jsonSchema.anyOf = [
          { not: { type: "integer" } },
          { minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }
        ];
    }
  });
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
  contractRange: CORE_CONTRACT_RANGE,
  features: [
    {
      id: WorkspaceFeature.Inspect,
      port: WorkspacePort.Configuration,
      operation: WorkspaceOperation.Read,
      requiredCapabilities: [WorkspaceCapability.Records]
    },
    {
      id: WorkspaceFeature.Rename,
      port: WorkspacePort.Configuration,
      operation: WorkspaceOperation.Rename,
      requiredCapabilities: [WorkspaceCapability.Rename]
    },
    {
      id: WorkspaceFeature.History,
      port: WorkspacePort.History,
      operation: WorkspaceOperation.List,
      requiredCapabilities: [WorkspaceCapability.VersionedHistory]
    }
  ]
};

export interface WorkspaceConfigurationPort {
  read(input: { root: string }): Promise<WorkspaceSnapshot>;
  rename?(input: RenameConfigurationInput): Promise<RenameConfigurationResult>;
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

export function encodeUniformName(value: string): string {
  if (!value) throw new Error("uniformName must not be empty");
  const normalized = value.normalize("NFC");
  let encoded = "";
  for (let index = 0; index < normalized.length; ) {
    const point = normalized.codePointAt(index)!;
    const character = String.fromCodePoint(point);
    if (point >= 0xd800 && point <= 0xdfff)
      throw new Error("uniformName contains an unpaired surrogate");
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
    } else encoded += character;
    index += character.length;
  }
  return encoded;
}

export function recordFileKey(id: string, uniformName: string, suffix = ""): string {
  uuidSchema.parse(id);
  const key = `${id}-${encodeUniformName(uniformName)}${suffix}`;
  if (key.length > 255 || new TextEncoder().encode(key).length > 255)
    throw new Error("Record filename exceeds 255 UTF-8 bytes or UTF-16 units");
  return key;
}

export interface EffectiveSettings {
  values: {
    launchEntry?: string | null;
    arguments?: string[];
    preferredAdapters?: Record<string, string | null>;
    adapterOptions?: Record<string, Record<string, ConfigurationValue> | null>;
  };
  origins: Record<string, string>;
}

export function resolveSettings(
  layers: readonly { name: string; settings: Settings }[]
): EffectiveSettings {
  const values: EffectiveSettings["values"] = {};
  const origins: Record<string, string> = Object.create(null);
  for (const layer of layers) {
    const settings = settingsSchema.parse(layer.settings);
    for (const field of ["launchEntry", "arguments"] as const) {
      if (settings[field] !== undefined) {
        if (field === "arguments") values.arguments = [...settings.arguments!];
        else values.launchEntry = settings.launchEntry;
        origins[field] = layer.name;
      }
    }
    for (const field of ["preferredAdapters", "adapterOptions"] as const) {
      if (!settings[field]) continue;
      if (field === "preferredAdapters")
        values.preferredAdapters = { ...values.preferredAdapters, ...settings.preferredAdapters };
      else values.adapterOptions = { ...values.adapterOptions, ...settings.adapterOptions };
      for (const key of Object.keys(settings[field])) origins[`${field}.${key}`] = layer.name;
    }
    if (settings.clear?.launchEntry) {
      values.launchEntry = null;
      origins.launchEntry = layer.name;
    }
    for (const key of settings.clear?.preferredAdapters ?? []) {
      values.preferredAdapters = { ...values.preferredAdapters, [key]: null };
      origins[`preferredAdapters.${key}`] = layer.name;
    }
    for (const key of settings.clear?.adapterOptions ?? []) {
      values.adapterOptions = { ...values.adapterOptions, [key]: null };
      origins[`adapterOptions.${key}`] = layer.name;
    }
  }
  return { values, origins };
}

export function validateRelationships(snapshot: WorkspaceSnapshot): void {
  const ids = new Set<string>();
  for (const record of [
    snapshot.workspace,
    ...snapshot.games,
    ...snapshot.hosts,
    ...snapshot.installations
  ]) {
    if (ids.has(record.id)) throw new Error(`Duplicate record ID: ${record.id}`);
    ids.add(record.id);
  }
  const games = new Map(snapshot.games.map((game) => [game.id, game]));
  const hosts = new Map(snapshot.hosts.map((host) => [host.id, host]));
  const unique = (items: string[], label: string) => {
    if (new Set(items).size !== items.length) throw new Error(`Duplicate ${label}`);
  };
  for (const game of snapshot.games) {
    for (const ref of game.externalRefs)
      if (!Object.keys(ref.key).length) throw new Error(`Empty external key: ${game.id}`);
  }
  for (const host of snapshot.hosts) {
    const paths = host.platform === HostPlatform.Windows ? win32 : posix;
    for (const [key, root] of Object.entries(host.roots)) {
      if (
        !paths.isAbsolute(root) ||
        (host.platform === HostPlatform.Windows &&
          !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(root))
      )
        throw new Error(`Host root must be absolute: ${key}`);
    }
    unique(
      host.sources.map((source) => source.id),
      `source ID in host ${host.id}`
    );
    for (const gameId of Object.keys(host.gameOverrides)) {
      if (!games.has(gameId)) throw new Error(`Unknown game override: ${gameId}`);
    }
  }
  for (const installation of snapshot.installations) {
    if (!games.has(installation.gameId)) throw new Error(`Unknown game: ${installation.gameId}`);
    const host = hosts.get(installation.hostId);
    if (!host) throw new Error(`Unknown host: ${installation.hostId}`);
    resolveInstallationPath(installation, host);
    if (!host.sources.some((source) => source.id === installation.sourceId))
      throw new Error(`Unknown source: ${installation.sourceId}`);
    if (
      installation.location.kind === LocationKind.Managed &&
      !Object.keys(installation.location.reference.key).length
    )
      throw new Error(`Empty managed key: ${installation.id}`);
    unique(
      installation.launchEntries.map((entry) => entry.id),
      `launch entry in ${installation.id}`
    );
  }
}

export function resolveInstallationPath(
  installation: InstallationRecord,
  host: HostRecord
): string | undefined {
  const location = installation.location;
  if (location.kind === LocationKind.Managed) return undefined;
  const paths = host.platform === HostPlatform.Windows ? win32 : posix;
  if (location.kind === LocationKind.Absolute) {
    if (
      !paths.isAbsolute(location.path) ||
      (host.platform === HostPlatform.Windows &&
        !/^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(location.path))
    )
      throw new Error(`Installation path must be absolute: ${installation.id}`);
    return paths.normalize(location.path);
  }
  const root = host.roots[location.rootKey];
  if (!root) throw new Error(`Unknown Host root: ${location.rootKey}`);
  if (
    paths.isAbsolute(location.path) ||
    (host.platform === HostPlatform.Windows &&
      (/^[a-z]:/i.test(location.path) || location.path.includes(":")))
  )
    throw new Error(`Installation relative path must be relative: ${installation.id}`);
  const result = paths.resolve(root, location.path);
  const relative = paths.relative(root, result);
  if (relative === ".." || relative.startsWith(`..${paths.sep}`) || paths.isAbsolute(relative))
    throw new Error(`Installation relative path escapes Host root: ${installation.id}`);
  return result;
}

// Operations belong to the Port; support and capabilities belong to AdapterDescriptor.
export interface ConfigurationHistoryPort {
  list(input: { cursor?: string; limit: number }): Promise<{
    head: string | null;
    entries: { id: string; summary: string; createdAt: string }[];
    nextCursor?: string;
  }>;
  findOperation(operationId: string): Promise<{ id: string } | null>;
  read(input: { id: string }): Promise<{
    id: string;
    records: { path: string; content: string }[];
  }>;
  record(input: {
    operationId: string;
    expectedHead: string | null;
    summary: string;
    changes: { path: string; beforeHash: string | null; content: string | null }[];
  }): Promise<
    | { status: typeof HistoryRecordStatus.Recorded; id: string }
    | { status: typeof HistoryRecordStatus.Conflict; actualHead: string | null }
    | { status: typeof HistoryRecordStatus.Failed; reason: string }
    | { status: typeof HistoryRecordStatus.Unknown; reason: string }
  >;
}
