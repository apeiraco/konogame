import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { recordFileKey, WORKSPACE_SCHEMA } from "@konogame/workspace";
import { v7 as uuidv7 } from "uuid";
import { createTestDirectory } from "./temp.ts";

export async function discoveryFixture(testGroup = "e2e") {
  const root = await createTestDirectory(import.meta.dirname, testGroup, "discovery");
  const workspace = join(root, "workspace");
  const hostId = uuidv7();
  await mkdir(join(workspace, ".konogame", "local"), { recursive: true });
  await writeFile(
    join(workspace, ".konogame", "workspace.toml"),
    `# Preserve this workspace comment\nkind = "workspace"\nschemaVersion = "${WORKSPACE_SCHEMA}"\nid = "${uuidv7()}"\nname = "Synthetic discovery lab"\ndefaults = {}\n[history]\nmode = "disabled"\n`
  );
  const hostFile = join(
    workspace,
    ".konogame",
    "local",
    recordFileKey(hostId, "Synthetic host", ".toml")
  );
  await writeFile(
    hostFile,
    `# Preserve this host comment\nkind = "host"\nschemaVersion = "${WORKSPACE_SCHEMA}"\nid = "${hostId}"\nuniformName = "Synthetic host"\nlabel = "Synthetic host"\nplatform = "windows"\nroots = {}\ndefaults = {}\ngameOverrides = {}\n[[sources]]\nid = "steam"\nkind = "steam"\nstatus = "configured"\n[[sources]]\nid = "standalone"\nkind = "standalone"\nstatus = "configured"\n`
  );
  const library = join(root, "steam-library");
  await mkdir(join(library, "steamapps", "common", "SyntheticSteam"), { recursive: true });
  const manifest = join(library, "steamapps", "appmanifest_730001.acf");
  await writeFile(
    manifest,
    '"AppState"\n{\n"appid" "730001"\n"name" "Synthetic Steam Game"\n"installdir" "SyntheticSteam"\n"StateFlags" "4"\n}\n'
  );
  const standalone = join(root, "standalone");
  await mkdir(join(standalone, "Synthetic Loose Game"), { recursive: true });
  await writeFile(join(standalone, "Synthetic Loose Game", "game.exe"), "synthetic, never execute");
  return { root, workspace, hostId, hostFile, library, manifest, standalone };
}

export async function directoryContents(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        result[relative(root, path)] = await readFile(path, "utf8");
      }
    }
  }
  await visit(root);
  return result;
}
