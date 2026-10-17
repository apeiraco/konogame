import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { RenameStatus, recordFileKey } from "@konogame/workspace";
import { v7 as uuidv7 } from "uuid";
import { afterEach, test, vi } from "vitest";
import { fixture } from "../support/workspace-fixture.ts";

const faults = vi.hoisted(() => ({
  count: 0,
  rename: undefined as undefined | ((from: string, to: string, count: number) => Promise<void>),
  unlink: undefined as undefined | ((path: string) => Promise<void>)
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (from: string, to: string) => {
      await faults.rename?.(String(from), String(to), ++faults.count);
      return fs.rename(from, to);
    },
    unlink: async (path: string) => {
      await faults.unlink?.(String(path));
      return fs.unlink(path);
    }
  };
});
afterEach(() => {
  faults.rename = undefined;
  faults.unlink = undefined;
  faults.count = 0;
});

const error = () => Object.assign(new Error("Injected filesystem failure"), { code: "EIO" });
const request = async (
  f: Awaited<ReturnType<typeof fixture>>,
  uniformName: string,
  recordId = f.game.id
) => ({
  root: f.root,
  recordId,
  uniformName,
  expectedRevision: (await f.read()).revision,
  operationId: uuidv7()
});

for (const layout of ["flat", "directory"] as const)
  test(`rename preserves ${layout} layout, comments, CRLF, UUID links and original Unicode`, async () => {
    const f = await fixture(layout);
    try {
      const before = `${(await f.text(f.paths.game))
        .replace(
          '"uniformName" = "Synthetic game"',
          '"uniformName" = """Synthetic game""" # keep comment'
        )
        .replaceAll("\n", "\r\n")}# tail\r\n`;
      await f.writeText(f.paths.game, before);
      const name = "Cafe\u0301: \u007f.";
      const result = await f.adapter.rename(await request(f, name));
      assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
      assert.notEqual(result.revision, undefined);
      const after = await f.read();
      assert.equal(after.games[0]?.uniformName, name);
      assert.equal(after.games[0]?.id, f.game.id);
      assert.equal(after.installations[0]?.gameId, f.game.id);
      const target =
        layout === "flat"
          ? `games/${recordFileKey(f.game.id, name, ".toml")}`
          : `games/${recordFileKey(f.game.id, name)}/game.toml`;
      assert.equal(
        await f.text(target),
        before.replace('"""Synthetic game"""', '"Cafe\u0301: \\u007F."')
      );
      assert.equal((await f.adapter.rename(await request(f, name))).status, RenameStatus.Unchanged);
      assert.deepEqual(await readdir(join(f.root, ".konogame", "recovery", "rename")), []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

for (const layout of ["flat", "directory"] as const)
  test(`Host rename moves ${layout} record and attached installations without editing UUID references`, async () => {
    const f = await fixture(layout);
    try {
      const original = await f.text(f.paths.installation);
      const result = await f.adapter.rename(await request(f, "Moved host", f.host.id));
      assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
      const movedInstallation = f.paths.installation.replace(
        f.paths.hostContainer,
        `local/${recordFileKey(f.host.id, "Moved host")}`
      );
      assert.equal(await f.text(movedInstallation), original);
      assert.equal((await f.read()).installations[0]?.hostId, f.host.id);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

test("installation rename preserves its source, location and game/host identities", async () => {
  const f = await fixture();
  try {
    const result = await f.adapter.rename(await request(f, "Second name", f.installation.id));
    assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
    assert.deepEqual((await f.read()).installations[0], {
      ...f.installation,
      uniformName: "Second name"
    });
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("case-only rename works on the real filesystem", async () => {
  const f = await fixture();
  try {
    const result = await f.adapter.rename(await request(f, "SYNTHETIC GAME"));
    assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
    assert.ok(
      (await readdir(join(f.root, ".konogame", "games"))).includes(
        recordFileKey(f.game.id, "SYNTHETIC GAME", ".toml")
      )
    );
    assert.equal((await f.read()).games[0]?.uniformName, "SYNTHETIC GAME");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("explicit rename repairs a manually changed suffix while preserving its original token", async () => {
  const f = await fixture();
  try {
    const content = await f.text(f.paths.game);
    await rename(
      join(f.root, ".konogame", f.paths.game),
      join(f.root, ".konogame", `games/${f.game.id}-Other.toml`)
    );
    const result = await f.adapter.rename(await request(f, f.game.uniformName));
    assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
    assert.equal(await f.text(f.paths.game), content);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("stale revisions, active writer locks, invalid inputs and occupied targets never overwrite files", async () => {
  const f = await fixture();
  try {
    const input = await request(f, "New name");
    await f.writeText(f.paths.game, `${await f.text(f.paths.game)}# external\n`);
    assert.equal((await f.adapter.rename(input)).status, RenameStatus.Conflict);
    const valid = await request(f, "New name");
    await writeFile(
      join(f.root, ".konogame", "recovery/rename/writer.lock"),
      JSON.stringify({ pid: process.pid, token: "other" })
    );
    assert.equal((await f.adapter.rename(valid)).status, RenameStatus.Conflict);
    await rm(join(f.root, ".konogame", "recovery/rename/writer.lock"));
    const target = `games/${recordFileKey(f.game.id, "New name", ".toml")}`;
    await f.writeText(target, "external bytes");
    assert.equal((await f.adapter.rename(valid)).status, RenameStatus.Failed);
    assert.equal(await f.text(target), "external bytes");
    await rm(join(f.root, ".konogame", target));
    assert.equal(
      (await f.adapter.rename({ ...valid, uniformName: "界".repeat(100) })).status,
      RenameStatus.Failed
    );
    assert.equal(
      (await f.adapter.rename({ ...valid, recordId: uuidv7() })).status,
      RenameStatus.Failed
    );
    assert.equal(
      (await f.adapter.rename({ ...valid, recordId: f.workspace.id })).status,
      RenameStatus.Failed
    );
    assert.equal(
      (await f.adapter.rename({ ...valid, operationId: "../escape" })).status,
      RenameStatus.Failed
    );
    assert.ok((await f.text(f.paths.game)).endsWith("# external\n"));
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("failure between moves rolls back safely when filesystem permits it", async () => {
  const f = await fixture();
  try {
    const before = await f.read();
    const input = await request(f, "New name");
    faults.rename = async (_from, _to, count) => {
      if (count === 2) throw error();
    };
    const result = await f.adapter.rename(input);
    assert.equal(result.status, RenameStatus.Failed, result.reason ?? "");
    assert.equal((await f.read()).revision, before.revision);
    assert.deepEqual(await readdir(join(f.root, ".konogame", "recovery/rename")), []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("failure after writing new content restores original content and paths", async () => {
  const f = await fixture();
  try {
    const before = await f.read();
    let injected = false;
    faults.unlink = async (path) => {
      if (!injected && path.endsWith("journal.json")) {
        injected = true;
        throw error();
      }
    };
    const result = await f.adapter.rename(await request(f, "New name"));
    assert.equal(result.status, RenameStatus.Failed, result.reason ?? "");
    assert.equal((await f.read()).revision, before.revision);
    assert.deepEqual(await readdir(join(f.root, ".konogame", "recovery/rename")), []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const record of ["game", "host"] as const)
  test(`interrupted ${record} rename resumes from journal after a staged move`, async () => {
    const f = await fixture();
    try {
      const id = record === "host" ? f.host.id : f.game.id;
      const input = await request(f, "Recovered name", id);
      faults.rename = async (_from, _to, count) => {
        if (count >= (record === "host" ? 4 : 2)) throw error();
      };
      const first = await f.adapter.rename(input);
      assert.equal(first.status, RenameStatus.RecoveryRequired, first.reason ?? "");
      assert.ok(
        (await readdir(join(f.root, ".konogame", "recovery/rename"))).includes("journal.json")
      );
      faults.rename = undefined;
      const resumed = await f.adapter.rename({ ...input, operationId: uuidv7() });
      assert.equal(resumed.status, RenameStatus.Renamed, resumed.reason ?? "");
      const after = await f.read();
      assert.equal(
        (record === "host" ? after.hosts : after.games)[0]?.uniformName,
        "Recovered name"
      );
      assert.equal(after.installations.length, 1);
      assert.deepEqual(await readdir(join(f.root, ".konogame", "recovery/rename")), []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

test("recovery refuses a different rename and never replaces external edits", async () => {
  const f = await fixture();
  try {
    const input = await request(f, "Recovered name");
    faults.rename = async (_from, _to, count) => {
      if (count >= 2) throw error();
    };
    assert.equal((await f.adapter.rename(input)).status, RenameStatus.RecoveryRequired);
    faults.rename = undefined;
    assert.equal(
      (await f.adapter.rename({ ...input, uniformName: "Different" })).status,
      RenameStatus.RecoveryRequired
    );
    const journal = JSON.parse(await f.text("recovery/rename/journal.json")) as {
      moves: { via: string }[];
    };
    const staged = journal.moves[0]!.via;
    const external = `${await f.text(staged)}# external edits\n`;
    await f.writeText(staged, external);
    assert.equal((await f.adapter.rename(input)).status, RenameStatus.RecoveryRequired);
    assert.equal(await f.text(staged), external);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("recovery directories and tampered journal paths cannot escape configuration", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "external"));
    await symlink(join(f.root, "external"), join(f.root, ".konogame", "recovery"), "junction");
    assert.equal(
      (await f.adapter.rename(await request(f, "New"))).status,
      RenameStatus.RecoveryRequired
    );
    assert.deepEqual(await readdir(join(f.root, "external")), []);
    await rm(join(f.root, ".konogame", "recovery"));
    const input = await request(f, "New");
    faults.rename = async (_from, _to, count) => {
      if (count >= 2) throw error();
    };
    await f.adapter.rename(input);
    faults.rename = undefined;
    const journal = JSON.parse(await f.text("recovery/rename/journal.json"));
    journal.moves[0].to = "../escape";
    await f.writeText("recovery/rename/journal.json", JSON.stringify(journal));
    assert.equal((await f.adapter.rename(input)).status, RenameStatus.RecoveryRequired);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

for (const record of ["game", "host"] as const)
  test(`actual child process crash releases stale lock and recovers ${record} through staged paths`, async () => {
    const f = await fixture();
    try {
      const input = await request(f, "After crash", record === "host" ? f.host.id : f.game.id);
      const script = `
      import fs from 'node:fs/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const rename = fs.rename;
      let count = 0;
      fs.rename = async (...args) => { if (++count === ${record === "host" ? 4 : 2}) process.exit(79); return rename(...args); };
      syncBuiltinESMExports();
      const { FilesystemWorkspaceConfiguration } = await import('@konogame/extension-filesystem');
      await new FilesystemWorkspaceConfiguration().rename(${JSON.stringify(input)});
      process.exit(0);
    `;
      await assert.rejects(
        () =>
          promisify(execFile)(process.execPath, ["--input-type=module", "-e", script], {
            cwd: process.cwd()
          }),
        (failure: unknown) => (failure as { code: number }).code === 79
      );
      assert.ok(await readFile(join(f.root, ".konogame", "recovery/rename/writer.lock"), "utf8"));
      const result = await f.adapter.rename({
        ...input,
        expectedRevision: "recovery-only",
        operationId: uuidv7()
      });
      assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
      const snapshot = await f.read();
      assert.equal(
        (record === "host" ? snapshot.hosts : snapshot.games)[0]?.uniformName,
        "After crash"
      );
      assert.equal(snapshot.installations.length, 1);
      assert.deepEqual(await readdir(join(f.root, ".konogame", "recovery/rename")), []);
      assert.equal(
        (
          await f.adapter.rename({
            ...input,
            uniformName: "Another new name",
            expectedRevision: "recovery-only"
          })
        ).status,
        RenameStatus.Conflict
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
