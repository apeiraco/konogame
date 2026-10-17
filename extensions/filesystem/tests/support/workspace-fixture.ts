import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FilesystemWorkspaceConfiguration } from "@konogame/extension-filesystem";
import {
  type GameRecord,
  type HostRecord,
  type InstallationRecord,
  recordFileKey
} from "@konogame/workspace";
import { records } from "../../../../packages/workspace/tests/support/records.ts";

function tomlValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (value && typeof value === "object")
    return `{ ${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`)
      .join(", ")} }`;
  throw new Error("Unsupported fixture value");
}
export function toml(record: object): string {
  return `${Object.entries(record)
    .map(([key, value]) => `${JSON.stringify(key)} = ${tomlValue(value)}`)
    .join("\n")}\n`;
}

export async function fixture(layout: "flat" | "directory" = "flat") {
  const root = await mkdtemp(join(tmpdir(), "konogame-workspace-"));
  const { workspace, game, host, installation } = records();
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
  const adapter = new FilesystemWorkspaceConfiguration();
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
