import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { type AdapterDescriptor } from "@konogame/contracts";
import {
  type ConfigurationRecord,
  RecordKind,
  type RenameConfigurationInput,
  type RenameConfigurationResult,
  recordFileKey,
  recordSchema,
  validateRelationships,
  WorkspaceCapability,
  type WorkspaceConfigurationPort,
  WorkspaceOperation,
  WorkspacePort,
  type WorkspaceSnapshot
} from "@konogame/workspace";
import { extensionMetadata } from "./metadata.ts";
import { parseConfigurationToml } from "./toml.ts";
import { renameConfiguration } from "./workspace-rename.ts";

export { parseConfigurationToml } from "./toml.ts";

export const filesystemWorkspaceConfigurationAdapter: AdapterDescriptor = {
  id: "filesystem.workspace-configuration",
  extensionId: "konogame.filesystem",
  port: WorkspacePort.Configuration,
  contractRange: extensionMetadata.contractRange,
  operations: [WorkspaceOperation.Read, WorkspaceOperation.Rename],
  capabilities: [WorkspaceCapability.Records, WorkspaceCapability.Rename]
};
export interface ConfigurationDocument {
  path: string;
  content: string;
  record: ConfigurationRecord;
  container?: string;
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const revisionOf = (documents: ConfigurationDocument[]) =>
  `sha256:${digest(JSON.stringify(documents.map(({ path, content }) => [path, content]).sort(([a], [b]) => a!.localeCompare(b!))))}`;
export const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}
export async function directory(path: string, optional = false): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Expected configuration directory: ${path}`);
    return true;
  } catch (error) {
    if (optional && missing(error)) return false;
    throw error;
  }
}
const filenamePattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(.+)$/u;

export async function loadConfigurationState(inputRoot: string) {
  const root = join(await realpath(inputRoot), ".konogame");
  await directory(root);
  const documents: ConfigurationDocument[] = [];
  const diagnostics: NonNullable<WorkspaceSnapshot["diagnostics"]> = [];
  const load = async (
    path: string,
    kind: ConfigurationRecord["kind"],
    key?: string,
    container?: string
  ): Promise<ConfigurationRecord> => {
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024)
      throw new Error(`Invalid configuration file: ${path}`);
    const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await readFile(join(root, path))
    );
    let record: ConfigurationRecord;
    try {
      record = recordSchema.parse(parseConfigurationToml(content).data);
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (record.kind !== kind || (key && record.id !== filenamePattern.exec(key)?.[1]))
      throw new Error(`Record kind/filename mismatch: ${path}`);
    if (key && record.kind !== RecordKind.Workspace) {
      const flat = path.endsWith(`${key}.toml`);
      const expected = recordFileKey(record.id, record.uniformName, flat ? ".toml" : "");
      if ((flat ? expected.slice(0, -5) : expected) !== key)
        diagnostics.push({
          path,
          message: `Filename suffix differs from uniformName; expected ${expected}`
        });
    }
    documents.push({ path, content, record, container });
    return record;
  };
  const scan = async (
    parent: string,
    kind: ConfigurationRecord["kind"]
  ): Promise<{ record: ConfigurationRecord; key: string; container: string }[]> => {
    if (!(await directory(join(root, parent), true))) return [];
    const records: { record: ConfigurationRecord; key: string; container: string }[] = [];
    const companions: string[] = [];
    for (const name of (await readdir(join(root, parent))).sort()) {
      const info = await lstat(join(root, parent, name));
      if (info.isSymbolicLink())
        throw new Error(`Configuration links are forbidden: ${parent}/${name}`);
      if (name.endsWith(".json"))
        throw new Error(`Incompatible legacy configuration record: ${parent}/${name}`);
      const key = info.isFile() && name.endsWith(".toml") ? name.slice(0, -5) : name;
      if (!filenamePattern.test(key)) {
        if (name.endsWith(".toml")) throw new Error(`Invalid record filename: ${parent}/${name}`);
        continue;
      }
      const container = `${parent}/${key}`;
      if (info.isFile() && name.endsWith(".toml"))
        records.push({
          record: await load(`${parent}/${name}`, kind, key, container),
          key,
          container
        });
      else if (info.isDirectory()) {
        const path = `${container}/${kind}.toml`;
        if (await exists(join(root, path)))
          records.push({ record: await load(path, kind, key, container), key, container });
        else if (kind === RecordKind.Host) companions.push(key);
        else throw new Error(`Missing ${kind}.toml: ${container}`);
      }
    }
    const companionIds = new Set<string>();
    for (const key of companions) {
      const id = filenamePattern.exec(key)![1]!;
      if (companionIds.has(id)) throw new Error(`Ambiguous Host companion containers: ${id}`);
      companionIds.add(id);
      const entry = records.find((record) => record.record.id === id);
      if (!entry) throw new Error(`Orphan Host container: ${parent}/${key}`);
      if (
        documents.find((document) => document.record === entry.record)?.path.endsWith("/host.toml")
      )
        throw new Error(`Ambiguous Host companion containers: ${id}`);
      entry.container = `${parent}/${key}`;
      const document = documents.find((document) => document.record === entry.record)!;
      document.container = entry.container;
      if (entry.key !== key)
        diagnostics.push({
          path: entry.container,
          message: "Host companion suffix differs from record filename; linked by UUID"
        });
    }
    return records;
  };
  if (await exists(join(root, "workspace.json")))
    throw new Error("Incompatible legacy workspace.json; workspace.toml is required");
  const workspace = await load("workspace.toml", RecordKind.Workspace);
  if (workspace.kind !== RecordKind.Workspace) throw new Error("Expected workspace");
  const snapshot: WorkspaceSnapshot = {
    workspace,
    games: [],
    hosts: [],
    installations: [],
    revision: "",
    diagnostics
  };
  for (const entry of await scan("games", RecordKind.Game))
    if (entry.record.kind === RecordKind.Game) snapshot.games.push(entry.record);
  for (const entry of await scan("local", RecordKind.Host)) {
    if (entry.record.kind !== RecordKind.Host) throw new Error("Expected Host");
    snapshot.hosts.push(entry.record);
    for (const installation of await scan(
      `${entry.container}/installations`,
      RecordKind.Installation
    )) {
      if (
        installation.record.kind !== RecordKind.Installation ||
        installation.record.hostId !== entry.record.id
      )
        throw new Error(`Installation host/path mismatch: ${installation.container}`);
      snapshot.installations.push(installation.record);
    }
  }
  snapshot.revision = revisionOf(documents);
  validateRelationships(snapshot);
  return { root, snapshot, documents };
}

export class FilesystemWorkspaceConfiguration implements WorkspaceConfigurationPort {
  async read(input: { root: string }): Promise<WorkspaceSnapshot> {
    return (await loadConfigurationState(input.root)).snapshot;
  }
  async rename(input: RenameConfigurationInput): Promise<RenameConfigurationResult> {
    return renameConfiguration(input);
  }
}
