import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { CORE_VERSION } from "@konogame/contracts";
import { test } from "vitest";

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, "../../../..");

test("release maintenance commands work from another cwd and every core executable reports the shared version", async () => {
  const entry = join(repository, "scripts/dev-cli/dist/main.js");
  const checked = await exec(process.execPath, [entry, "release", "check", "--json"], {
    cwd: tmpdir()
  });
  assert.equal(JSON.parse(checked.stdout).version, CORE_VERSION);
  for (const bin of ["apps/cli", "apps/daemon", "scripts/dev-cli"]) {
    const result = await exec(
      process.execPath,
      [join(repository, bin, "dist/main.js"), "--version"],
      { cwd: tmpdir(), timeout: 8_000 }
    );
    assert.ok(result.stdout.includes(CORE_VERSION));
    assert.equal(result.stderr, "");
  }
  const preview = await exec(
    process.execPath,
    [entry, "release", "version", "0.1.0-alpha.1", "--dry-run", "--json"],
    { cwd: tmpdir() }
  );
  assert.equal(JSON.parse(preview.stdout).dryRun, true);
});
