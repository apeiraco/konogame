import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

for (const entry of [
  "apps/cli/src/main.ts",
  "apps/cli/dist/main.js",
  "apps/daemon/src/main.ts",
  "apps/daemon/dist/main.js",
  "scripts/dev-cli/src/main.ts",
  "scripts/dev-cli/dist/main.js",
  "apps/shared/src/index.ts",
  "apps/shared/dist/index.js"
]) {
  test(`importing ${entry} is silent, starts no server, and does not parse runtime environment`, async () => {
    const url = pathToFileURL(resolve(root, entry)).href;
    const { stdout, stderr } = await exec(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      const original = process.env;
      process.env = new Proxy(original, {
        get(target, key) {
          if (["KONOGAME_DAEMON_PORT", "KONOGAME_SAVE_ROOT", "INTERACTIVE"].includes(key)) throw new Error("Runtime environment read during import: " + key);
          return Reflect.get(target, key);
        }
      });
      await import(${JSON.stringify(url)});
      if (process.exitCode !== undefined && process.exitCode !== 0) throw new Error("Import changed exit status");
    `
      ],
      { cwd: tmpdir(), timeout: 8_000 }
    );
    expect(stdout).toBe("");
    expect(stderr).toBe("");
  });
}

test("built public workspace packages import in real Node", async () => {
  const packages = [
    "@konogame/contracts",
    "@konogame/workspace",
    "@konogame/save",
    "@konogame/application",
    "@konogame/extension-filesystem",
    "@konogame/local-runtime"
  ];
  const { stdout, stderr } = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    for (const name of ${JSON.stringify(packages)}) {
      const resolved = import.meta.resolve(name);
      if (!resolved.includes("/dist/") || !resolved.endsWith(".js")) throw new Error("Non-built export: " + resolved);
      await import(name);
    }
  `
    ],
    { cwd: root, timeout: 8_000 }
  );
  expect(stdout).toBe("");
  expect(stderr).toBe("");
});
