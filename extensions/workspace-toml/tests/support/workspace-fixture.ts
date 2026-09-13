import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type IdService, UuidIdService } from "@konogame/infrastructure";
import { type LocationPort } from "@konogame/infrastructure/contracts";
import {
  type GameRecord,
  type HostRecord,
  type InstallationRecord,
  recordFileKey
} from "@konogame/workspace";
import { Effect } from "effect";
import { afterEach } from "vitest";
import { records } from "../../../../packages/workspace/tests/support/records.ts";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import {
  NodeWorkspaceFileSystem,
  NodeWorkspaceImportFileSystem,
  NodeWorkspaceManagementFileSystem,
  TomlWorkspaceConfiguration,
  type WorkspaceImportFileSystem,
  type WorkspaceManagementFileSystem,
  type WorkspaceNodeFileSystem
} from "../../src/index.ts";

export function workspaceConfiguration(
  options: {
    nodeFileSystem?: WorkspaceNodeFileSystem;
    ids?: IdService;
    importFileSystem?: WorkspaceImportFileSystem;
    managementFileSystem?: WorkspaceManagementFileSystem;
    locationBehavior?: LocationPort;
  } = {}
): TomlWorkspaceConfiguration {
  const node = options.nodeFileSystem ?? new NodeWorkspaceFileSystem();
  const ids = options.ids ?? new UuidIdService();
  return new TomlWorkspaceConfiguration(
    node,
    options.importFileSystem ?? new NodeWorkspaceImportFileSystem(node, ids),
    options.managementFileSystem ?? new NodeWorkspaceManagementFileSystem(node, ids),
    options.locationBehavior,
    ids
  );
}

const roots: string[] = [];
export const locationBehavior: LocationPort = {
  validate: ({ location }) =>
    Effect.succeed({ status: location.type === "fixture.location" ? "valid" : "unverified" }),
  compare: ({ left, right }) =>
    Effect.sync(() => {
      if (left.type !== "fixture.location" || right.type !== "fixture.location") {
        return { status: "incomparable" };
      }
      const key = (value: typeof left) => (value.data as { key: string }).key;
      return { status: key(left) === key(right) ? "equal" : "different" };
    }),
  resolve: ({ location }) => Effect.succeed({ status: "resolved", resource: location })
};
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tomlValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (value && typeof value === "object") {
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`)
      .join(", ")} }`;
  }
  throw new Error("Unsupported fixture value");
}
export function toml(record: object): string {
  return `${Object.entries(record)
    .map(([key, value]) => `${JSON.stringify(key)} = ${tomlValue(value)}`)
    .join("\n")}\n`;
}

export async function fixture(
  layout: "flat" | "directory" = "flat",
  options: Parameters<typeof workspaceConfiguration>[0] = {}
) {
  const root = await createTestDirectory(import.meta.dirname, "integration", "workspace");
  roots.push(root);
  const { workspace, game, host, installation } = records();
  installation.location = {
    type: "fixture.location",
    schemaVersion: "1.0.0",
    data: { key: "synthetic" }
  };
  const hostContainer = `local/${recordFileKey(host.id, host.uniformName)}`;
  const recordPath = (parent: string, record: GameRecord | HostRecord | InstallationRecord) =>
    layout === "flat"
      ? `${parent}/${recordFileKey(record.id, record.uniformName, ".toml")}`
      : `${parent}/${recordFileKey(record.id, record.uniformName)}/${record.kind}.toml`;
  const paths = {
    game: recordPath("games", game),
    host: recordPath("local", host),
    installation: recordPath(`${hostContainer}/installations`, installation),
    hostContainer
  };
  const writeText = async (path: string, content: string) => {
    const target = join(root, ".konogame", path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  const write = async (path: string, record: object) => writeText(path, toml(record));
  await write("workspace.toml", workspace);
  await write(paths.game, game);
  await write(paths.host, host);
  await write(paths.installation, installation);
  const adapter = workspaceConfiguration({ locationBehavior, ...options });
  return {
    root,
    workspace,
    game,
    host,
    installation,
    paths,
    write,
    writeText,
    adapter,
    read: () => adapter.read({ root }),
    text: (path: string) => readFile(join(root, ".konogame", path), "utf8")
  };
}
