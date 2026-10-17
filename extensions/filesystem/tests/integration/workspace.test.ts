import assert from "node:assert/strict";
import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLocalApplication } from "@konogame/local-runtime";
import {
  HistoryAvailability,
  HistoryMode,
  LocationKind,
  resolveInstallationPath
} from "@konogame/workspace";
import { v7 as uuidv7 } from "uuid";
import { test } from "vitest";
import { fixture } from "../support/workspace-fixture.ts";

for (const layout of ["flat", "directory"] as const)
  test(`inspection reads ${layout} records, applies seven layers and preserves identity`, async () => {
    const f = await fixture(layout);
    try {
      const before = await f.read();
      const app = createLocalApplication();
      const selected = await app.inspectWorkspace(f.root, {
        hostId: f.host.id,
        installationId: f.installation.id,
        overrides: { arguments: ["once"], clear: { preferredAdapters: ["save.store"] } }
      });
      assert.deepEqual(selected.effective.values.arguments, ["once"]);
      assert.equal(selected.effective.origins.arguments, "invocation");
      assert.equal(selected.effective.values.preferredAdapters?.["save.store"], null);
      assert.equal(selected.history.status, HistoryAvailability.Disabled);
      assert.equal((await f.read()).revision, before.revision);
      assert.equal(resolveInstallationPath(f.installation, f.host), "D:\\Games\\Synthetic");
      await assert.rejects(
        () => app.inspectWorkspace(f.root, { installationId: f.installation.id }),
        /host explicitly/
      );
      await assert.rejects(
        () =>
          app.inspectWorkspace(f.root, {
            hostId: f.host.id,
            installationId: f.installation.id,
            overrides: { launchEntry: "missing" }
          }),
        /Unknown effective launch/
      );
      await f.write("workspace.toml", {
        ...f.workspace,
        history: { mode: HistoryMode.Adapter, adapterId: "missing" }
      });
      assert.equal(
        (await app.inspectWorkspace(f.root)).history.status,
        HistoryAvailability.Unavailable
      );
      await f.write(f.paths.installation, {
        ...f.installation,
        location: { kind: LocationKind.Absolute, path: "E:/Moved/Game" }
      });
      assert.equal((await f.read()).installations[0]?.id, f.installation.id);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

test("UUID is identity, filename suffix is diagnostic, and duplicate records are errors", async () => {
  const f = await fixture();
  try {
    const renamed = `games/${f.game.id}-Human rename.toml`;
    await rename(join(f.root, ".konogame", f.paths.game), join(f.root, ".konogame", renamed));
    assert.equal((await f.read()).games[0]?.id, f.game.id);
    assert.equal((await f.read()).diagnostics?.length, 1);
    const newHostContainer = `local/${f.host.id}-Other suffix`;
    await rename(
      join(f.root, ".konogame", f.paths.hostContainer),
      join(f.root, ".konogame", newHostContainer)
    );
    assert.equal((await f.read()).installations.length, 1);
    await f.write(`games/${f.game.id}-Duplicate/game.toml`, f.game);
    await assert.rejects(f.read, /Duplicate record ID/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("reader reports incompatible records, dangling references, malformed filenames and symlinks", async () => {
  const f = await fixture();
  try {
    await f.write(f.paths.installation, { ...f.installation, gameId: uuidv7() });
    await assert.rejects(f.read, /Unknown game/);
    await f.write(f.paths.installation, { ...f.installation, id: uuidv7() });
    await assert.rejects(f.read, /filename mismatch/);
    await f.write(f.paths.installation, f.installation);
    await f.write("games/bad.toml", f.game);
    await assert.rejects(f.read, /Invalid record filename/);
    await rm(join(f.root, ".konogame", "games/bad.toml"));
    await writeFile(join(f.root, ".konogame", "workspace.json"), "{}");
    await assert.rejects(f.read, /Incompatible legacy/);
    await rm(join(f.root, ".konogame", "workspace.json"));
    await f.write(f.paths.host, { ...f.host, roots: { games: "relative" } });
    await assert.rejects(f.read, /root must be absolute/);
    await f.write(f.paths.host, f.host);
    await mkdir(join(f.root, "outside"));
    await symlink(join(f.root, "outside"), join(f.root, ".konogame", "games", "link"), "junction");
    await assert.rejects(f.read, /links are forbidden/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
