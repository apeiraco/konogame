import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeNewConfiguration } from "@konogame/extension-workspace-toml";
import { recordFileKey } from "@konogame/workspace";
import { expect, test } from "vitest";
import { records } from "../../packages/workspace/tests/support/records.ts";
import { executeTestProcess } from "../support/process.ts";
import { createTestDirectory } from "../support/temp.ts";

test("a resolve hook that rejects filesystem Extension packages leaves its Location unverified", async () => {
  const root = await createTestDirectory(
    import.meta.dirname,
    "e2e",
    "location-composition",
    "workspace"
  );
  try {
    const { workspace, game, host, installation } = records();
    const base = join(root, ".konogame");
    const hostContainer = join(base, "local", recordFileKey(host.id, host.uniformName));
    const installationPath = join(
      hostContainer,
      "installations",
      recordFileKey(installation.id, installation.uniformName, ".toml")
    );
    const entries = [
      [join(base, "workspace.toml"), workspace],
      [join(base, "games", recordFileKey(game.id, game.uniformName, ".toml")), game],
      [join(base, "local", recordFileKey(host.id, host.uniformName, ".toml")), host],
      [installationPath, installation]
    ] as const;
    for (const [path, record] of entries) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        `# Unknown Location must survive without its Extension\n${serializeNewConfiguration(record)}`
      );
    }
    const { stdout, stderr } = await executeTestProcess(
      process.execPath,
      [fileURLToPath(new URL("../support/location-composition-child.ts", import.meta.url)), root],
      { cwd: root, timeout: 15_000 }
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout).locationStatus.validation.status).toBe("unverified");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
