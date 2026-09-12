import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runBuiltCli } from "../support/cli.ts";
import { createTestDirectory } from "../support/temp.ts";

const platform =
  process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";

test("the built CLI accepts argv and publishes a Workspace file", async () => {
  const root = await createTestDirectory(import.meta.dirname, "e2e", "built-cli", "init");
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  try {
    const result = await runBuiltCli(
      [
        "workspace",
        "init",
        workspace,
        "--name",
        "Synthetic library",
        "--host-name",
        "Primary",
        "--platform",
        platform,
        "--yes",
        "--json"
      ],
      root
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout).status).toBe("initialized");
    expect(await readFile(join(workspace, ".konogame", "workspace.toml"), "utf8")).toContain(
      "Synthetic library"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
