import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { repositoryRoot } from "@konogame/dev-cli";
import { expect, test } from "vitest";

const exec = promisify(execFile);

test("documentation checker resolves the repository from both source and built executable outside cwd", async () => {
  const root = resolve(import.meta.dirname, "../../../..");
  expect(repositoryRoot()).toBe(root);
  for (const suffix of ["src/main.ts", "dist/main.js"]) {
    const result = await exec(process.execPath, [join(root, "scripts/dev-cli", suffix), "--help"], {
      cwd: tmpdir()
    });
    expect(result.stdout).toContain("check-docs");
    expect(result.stderr).toBe("");
  }
});
