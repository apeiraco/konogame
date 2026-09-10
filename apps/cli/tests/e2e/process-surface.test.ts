import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { executeTestProcess } from "../../../../tests/support/process.ts";
import { createTestDirectory } from "../../../../tests/support/temp.ts";

test("built CLI keeps owner Context across commands and writes logger diagnostics to stderr", async () => {
  const cwd = await createTestDirectory(import.meta.dirname, "e2e", "process-surface", "cwd");
  const report = join(cwd, "owner.json");
  const { stdout, stderr } = await executeTestProcess(
    process.execPath,
    [
      fileURLToPath(new URL("./process-surface.ts", import.meta.url)),
      new URL("../../dist/main.js", import.meta.url).href,
      report
    ],
    { cwd, timeout: 15_000 }
  );
  expect(JSON.parse(await readFile(report, "utf8"))).toEqual([
    { code: 0, data: ["first"], stderr: "" },
    { code: 0, data: ["second"], stderr: "" }
  ]);
  expect(JSON.parse(stdout)).toContain("save.store");
  expect(stderr).toContain("Synthetic recovery-required diagnostic");
});
