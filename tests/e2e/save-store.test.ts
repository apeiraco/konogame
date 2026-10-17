import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const exec = promisify(execFile);

test("the built CLI stores a multi-file save into the explicitly selected filesystem store", async () => {
  const root = await mkdtemp(join(tmpdir(), "konogame-save-e2e-"));
  try {
    const input = join(root, "input");
    const store = join(root, "store");
    await mkdir(join(input, "slot"), { recursive: true });
    await writeFile(join(input, "slot/state.dat"), Buffer.from([0, 1, 2, 255]));
    await writeFile(join(input, "settings.ini"), "volume=50\n");
    const entry = resolve(import.meta.dirname, "../../apps/cli/dist/main.js");
    const result = await exec(
      process.execPath,
      [entry, "save", "store", input, "--json", "--non-interactive"],
      {
        cwd: tmpdir(),
        env: { ...process.env, KONOGAME_SAVE_ROOT: store },
        timeout: 8_000
      }
    );
    expect(result.stderr).toBe("");
    const reference = JSON.parse(result.stdout) as { id: string };
    expect(reference.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(await readFile(join(store, reference.id, "files/slot/state.dat"))).toEqual(
      Buffer.from([0, 1, 2, 255])
    );
    expect(await readFile(join(store, reference.id, "files/settings.ini"), "utf8")).toBe(
      "volume=50\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
