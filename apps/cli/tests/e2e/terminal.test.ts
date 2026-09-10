import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { directoryContents } from "../../../../tests/support/discovery.ts";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { runTerminalCli } from "../../../../tests/support/terminal.ts";

test("real terminal cancellation preserves the selected directory and typed initialization publishes a readable Workspace", async () => {
  const root = await createTestDirectory(import.meta.dirname, "e2e", "terminal", "workspace");
  try {
    await writeFile(join(root, "preserve.txt"), "Existing user file");
    const before = await directoryContents(root);
    const entriesBefore = await readdir(root);
    const flags = [
      "--name",
      "Terminal library",
      "--host-name",
      "Terminal Host",
      "--platform",
      "windows"
    ];
    const cancelled = await runTerminalCli(["workspace", "init", root, ...flags], root, [
      { prompt: /Initialize Terminal library/, input: "\x03" }
    ]);
    expect(cancelled.exitCode).toBe(130);
    expect(cancelled.output).toContain("Cancelled");
    expect(await directoryContents(root)).toEqual(before);
    expect(await readdir(root)).toEqual(entriesBefore);
    const initialized = await runTerminalCli(["workspace", "init", ...flags], root, [
      { prompt: /root/, input: `${root}\r` },
      { prompt: /Initialize Terminal library/, input: "y\r" }
    ]);
    expect(initialized.exitCode).toBe(0);
    expect(initialized.output).toContain('"status": "initialized"');
    expect(await readFile(join(root, ".konogame", "workspace.toml"), "utf8")).toContain(
      "Terminal library"
    );
    expect(await readFile(join(root, "preserve.txt"), "utf8")).toBe("Existing user file");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
