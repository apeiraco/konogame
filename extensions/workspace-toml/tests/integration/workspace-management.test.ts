import assert from "node:assert/strict";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, it as test } from "@effect/vitest";
import { UuidIdService } from "@konogame/infrastructure";
import { EditStatus, InitializeStatus, RecordKind, recordFileKey } from "@konogame/workspace";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { records } from "../../../../packages/workspace/tests/support/records.ts";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { NodeWorkspaceFileSystem, WorkspaceFileSystemError } from "../../src/filesystem/node.ts";
import { NodeWorkspaceManagementFileSystem } from "../../src/index.ts";
import { nativePromise, rejects } from "../support/effects.ts";
import { fixture, workspaceConfiguration } from "../support/workspace-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function empty() {
  return Effect.gen(function* () {
    const root = yield* nativePromise(
      createTestDirectory(import.meta.dirname, "integration", "management")
    );
    roots.push(root);
    const { workspace, host } = records();
    workspace.defaults = {};
    host.gameOverrides = {};
    return { root, operationId: uuidv7(), workspace, host };
  });
}
class FailureFileSystem extends NodeWorkspaceManagementFileSystem {
  constructor() {
    super(new NodeWorkspaceFileSystem(), new UuidIdService());
  }

  failCreate?: (path: string) => boolean;
  failReplace = false;
  failAfterReplace = false;
  failLockCleanup = false;
  failAfterJournal = false;
  override create(path: string, content: string) {
    const supercreate = super.create.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (this.failCreate?.(path)) {
        this.failCreate = undefined;
        return yield* Effect.fail(
          WorkspaceFileSystemError.from(
            "injected-test-failure",
            new Error("Injected publication failure")
          )
        );
      }
      yield* supercreate(path, content);
      if (this.failAfterJournal && path.replaceAll("\\", "/").endsWith("edit/journal.json")) {
        this.failAfterJournal = false;
        return yield* Effect.fail(
          WorkspaceFileSystemError.from(
            "injected-test-failure",
            new Error("Injected failure after journal publication")
          )
        );
      }
    });
  }
  override replace(path: string, content: string, before: string, operationId: string) {
    const superreplace = super.replace.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (this.failReplace) {
        this.failReplace = false;
        return yield* Effect.fail(
          WorkspaceFileSystemError.from(
            "injected-test-failure",
            new Error("Injected replacement failure")
          )
        );
      }
      yield* superreplace(path, content, before, operationId);
      if (this.failAfterReplace) {
        this.failAfterReplace = false;
        return yield* Effect.fail(
          WorkspaceFileSystemError.from(
            "injected-test-failure",
            new Error("Injected failure after atomic publication")
          )
        );
      }
    });
  }
  override remove(path: string) {
    const superremove = super.remove.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (this.failLockCleanup && path.endsWith("writer.lock")) {
        return yield* Effect.fail(
          WorkspaceFileSystemError.from(
            "injected-test-failure",
            new Error("Injected lock cleanup failure")
          )
        );
      }
      return yield* superremove(path);
    });
  }
}

test.effect(
  "initialization preserves existing root files, publishes directory Host, and rejects existing/absent roots",
  () =>
    Effect.gen(function* () {
      const input = yield* empty();
      yield* nativePromise(writeFile(join(input.root, "notes.txt"), "user data"));
      yield* nativePromise(writeFile(join(input.root, ".gitignore"), "user ignore\r\n"));
      const adapter = workspaceConfiguration();
      const result = yield* adapter.initialize(input);
      assert.equal(result.status, InitializeStatus.Initialized, result.reason!);
      const state = yield* adapter.read(input);
      assert.equal(state.hosts[0]?.id, input.host.id);
      assert.equal(state.workspace.history.mode, "disabled");
      assert.equal(
        yield* nativePromise(readFile(join(input.root, "notes.txt"), "utf8")),
        "user data"
      );
      assert.equal(
        yield* nativePromise(readFile(join(input.root, ".gitignore"), "utf8")),
        "user ignore\r\n"
      );
      assert.equal(
        yield* nativePromise(readFile(join(input.root, ".konogame/.gitignore"), "utf8")),
        "/local/\n/cache/\n/recovery/\n.konogame-edit-*.tmp*\n"
      );
      assert.equal(
        (yield* adapter.initialize({ ...input, operationId: uuidv7() })).status,
        InitializeStatus.Conflict
      );
      assert.equal(
        (yield* adapter.initialize({
          ...input,
          root: join(input.root, "absent")
        })).status,
        InitializeStatus.Failed
      );
      assert.equal(
        (yield* adapter.recoverInitialize({
          root: input.root,
          operationId: input.operationId
        })).status,
        InitializeStatus.Initialized
      );
    })
);

test.effect(
  "empty existing configuration is never overwritten and interrupted reservation is diagnosed",
  () =>
    Effect.gen(function* () {
      const input = yield* empty();
      yield* nativePromise(mkdir(join(input.root, ".konogame")));
      const adapter = workspaceConfiguration();
      const result = yield* adapter.initialize(input);
      assert.equal(result.status, InitializeStatus.Conflict);
      assert.match(result.reason!, /manual inspection/);
      const recovered = yield* adapter.recoverInitialize({
        root: input.root,
        operationId: input.operationId
      });
      assert.equal(recovered.status, InitializeStatus.RecoveryRequired);
      assert.match(recovered.reason!, /manually/);
    })
);

test.effect.each(["stage", "host", "workspace"])(
  "initialization recovery completes only the approved files after %s failure",
  (phase) =>
    Effect.gen(function* () {
      const input = yield* empty();
      const fs = new FailureFileSystem();
      fs.failCreate = (path) =>
        phase === "stage"
          ? path.endsWith("-1.stage")
          : phase === "host"
            ? path.endsWith("host.toml")
            : path.endsWith("workspace.toml");
      const adapter = workspaceConfiguration({ managementFileSystem: fs });
      const failed = yield* adapter.initialize(input);
      assert.equal(failed.status, InitializeStatus.RecoveryRequired, failed.reason!);
      yield* nativePromise(assert.rejects(readFile(join(input.root, ".konogame/workspace.toml"))));
      const recovered = yield* adapter.recoverInitialize({
        root: input.root,
        operationId: input.operationId
      });
      assert.equal(recovered.status, InitializeStatus.Initialized, recovered.reason!);
      assert.equal((yield* adapter.read(input)).hosts.length, 1);
    })
);

test.effect(
  "initialization recovery rejects externally changed published metadata and wrong operation IDs",
  () =>
    Effect.gen(function* () {
      const input = yield* empty();
      const fs = new FailureFileSystem();
      fs.failCreate = (path) => path.endsWith("workspace.toml");
      const adapter = workspaceConfiguration({ managementFileSystem: fs });
      assert.equal((yield* adapter.initialize(input)).status, InitializeStatus.RecoveryRequired);
      const path = join(
        input.root,
        `.konogame/local/${recordFileKey(input.host.id, input.host.uniformName)}/host.toml`
      );
      const external = `${yield* nativePromise(readFile(path, "utf8"))}# external\n`;
      yield* nativePromise(writeFile(path, external));
      assert.equal(
        (yield* adapter.recoverInitialize({
          root: input.root,
          operationId: uuidv7()
        })).status,
        InitializeStatus.RecoveryRequired
      );
      assert.equal(
        (yield* adapter.recoverInitialize({
          root: input.root,
          operationId: input.operationId
        })).status,
        InitializeStatus.RecoveryRequired
      );
      assert.equal(yield* nativePromise(readFile(path, "utf8")), external);
    })
);

test.effect.each(["flat", "directory"] as const)(
  "%s single-record edits preserve unrelated CRLF, comments, opaque locations, and record layout",
  (layout) =>
    Effect.gen(function* () {
      const data = yield* nativePromise(fixture(layout));
      const content = (yield* nativePromise(data.text(data.paths.game)))
        .replaceAll("\n", "\r\n")
        .replace('"title" = "Synthetic game"', '"title" = "Synthetic game" # title');
      yield* nativePromise(data.writeText(data.paths.game, content));
      data.installation.location = {
        type: "unknown.future",
        schemaVersion: "9.0.0",
        data: { opaque: ["kept"] }
      };
      yield* nativePromise(data.write(data.paths.installation, data.installation));
      const installation = yield* nativePromise(data.text(data.paths.installation));
      const host = yield* nativePromise(data.text(data.paths.host));
      const result = yield* data.adapter.edit({
        root: data.root,
        operationId: uuidv7(),
        expectedRevision: (yield* data.read()).revision,
        change: {
          kind: "metadata.replace",
          target: { kind: RecordKind.Game, recordId: data.game.id },
          metadata: { title: "Changed title", edition: "Deluxe" }
        }
      });
      assert.equal(result.status, EditStatus.Edited, result.reason!);
      assert(
        (yield* nativePromise(data.text(data.paths.game))).includes('"Changed title" # title\r\n')
      );
      assert.equal(yield* nativePromise(data.text(data.paths.installation)), installation);
      assert.equal(yield* nativePromise(data.text(data.paths.host)), host);
      assert.deepEqual(
        JSON.parse(JSON.stringify((yield* data.read()).installations[0]?.location)),
        data.installation.location
      );
    })
);

test.effect("settings replace supports Host/Game removal, explicit clear and empty arguments", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    let result = yield* data.adapter.edit({
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "settings.replace",
        target: {
          kind: "host-game",
          recordId: data.host.id,
          gameId: data.game.id
        },
        settings: {}
      }
    });
    assert.equal(result.status, EditStatus.Edited, result.reason!);
    assert.equal(Object.keys((yield* data.read()).hosts[0]!.gameOverrides).length, 0);
    result = yield* data.adapter.edit({
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "settings.replace",
        target: {
          kind: RecordKind.Installation,
          recordId: data.installation.id
        },
        settings: { arguments: [], clear: { launchEntry: true } }
      }
    });
    assert.equal(result.status, EditStatus.Edited, result.reason!);
    assert.deepEqual((yield* data.read()).installations[0]?.settings, {
      arguments: [],
      clear: { launchEntry: true }
    });
  })
);

test.effect("referenced source removal and kind change fail without touching Host metadata", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const before = yield* nativePromise(data.text(data.paths.host));
    for (const sources of [[], [{ ...data.host.sources[0]!, kind: "other" }]]) {
      const result = yield* data.adapter.edit({
        root: data.root,
        operationId: uuidv7(),
        expectedRevision: (yield* data.read()).revision,
        change: {
          kind: "host.sources.replace",
          hostId: data.host.id,
          sources
        }
      });
      assert.equal(result.status, EditStatus.Failed, result.reason!);
      assert.equal(yield* nativePromise(data.text(data.paths.host)), before);
    }
  })
);

test.effect.each([false, true])(
  "edit recovery handles failure before/after atomic replacement (after=%s)",
  (after) =>
    Effect.gen(function* () {
      const data = yield* nativePromise(fixture());
      const fs = new FailureFileSystem();
      fs.failReplace = !after;
      fs.failAfterReplace = after;
      const adapter = workspaceConfiguration({ managementFileSystem: fs });
      const operationId = uuidv7();
      const result = yield* adapter.edit({
        root: data.root,
        operationId,
        expectedRevision: (yield* data.read()).revision,
        change: {
          kind: "metadata.replace",
          target: { kind: RecordKind.Workspace, recordId: data.workspace.id },
          metadata: { name: "Updated" }
        }
      });
      assert.equal(result.status, EditStatus.RecoveryRequired, result.reason!);
      assert.equal(
        (yield* adapter.recoverEdit({ root: data.root, operationId: uuidv7() })).status,
        EditStatus.RecoveryRequired
      );
      const recovered = yield* adapter.recoverEdit({
        root: data.root,
        operationId
      });
      assert.equal(recovered.status, EditStatus.Edited, recovered.reason!);
      assert.equal((yield* data.read()).workspace.name, "Updated");
      assert.equal(
        (yield* adapter.recoverEdit({ root: data.root, operationId })).status,
        EditStatus.Unchanged
      );
    })
);

test.effect.each([false, true])(
  "new Host recovery accepts approved empty/staged containers (staged=%s)",
  (staged) =>
    Effect.gen(function* () {
      const data = yield* nativePromise(fixture());
      const host = { ...records().host, gameOverrides: {} };
      const fs = new FailureFileSystem();
      fs.failCreate = (path) => path.includes(host.id) && path.endsWith("host.toml");
      const adapter = workspaceConfiguration({ managementFileSystem: fs });
      const operationId = uuidv7();
      const result = yield* adapter.edit({
        root: data.root,
        operationId,
        expectedRevision: (yield* data.read()).revision,
        change: { kind: "host.create", host }
      });
      assert.equal(result.status, EditStatus.RecoveryRequired, result.reason!);
      yield* rejects(data.read(), /Orphan Host container/);
      if (staged) {
        const journal = JSON.parse(
          yield* nativePromise(
            readFile(join(data.root, ".konogame/recovery/edit/journal.json"), "utf8")
          )
        ) as { after: string; path: string };
        yield* nativePromise(
          writeFile(
            join(data.root, ".konogame", `${journal.path}.pending-${uuidv7()}`),
            journal.after
          )
        );
      }
      const recovered = yield* adapter.recoverEdit({
        root: data.root,
        operationId
      });
      assert.equal(recovered.status, EditStatus.Edited, recovered.reason!);
      assert.equal((yield* data.read()).hosts.length, 2);
    })
);

test.effect(
  "new Host recovery rejects changed originals before publishing into its empty container",
  () =>
    Effect.gen(function* () {
      const data = yield* nativePromise(fixture());
      const host = { ...records().host, gameOverrides: {} };
      const fs = new FailureFileSystem();
      fs.failCreate = (path) => path.includes(host.id) && path.endsWith("host.toml");
      const adapter = workspaceConfiguration({ managementFileSystem: fs });
      const operationId = uuidv7();
      assert.equal(
        (yield* adapter.edit({
          root: data.root,
          operationId,
          expectedRevision: (yield* data.read()).revision,
          change: { kind: "host.create", host }
        })).status,
        EditStatus.RecoveryRequired
      );
      const external = `${yield* nativePromise(data.text(data.paths.game))}# changed original\n`;
      yield* nativePromise(data.writeText(data.paths.game, external));
      assert.equal(
        (yield* adapter.recoverEdit({ root: data.root, operationId })).status,
        EditStatus.RecoveryRequired
      );
      yield* nativePromise(
        assert.rejects(
          readFile(
            join(data.root, `.konogame/local/${recordFileKey(host.id, host.uniformName)}/host.toml`)
          )
        )
      );
      assert.equal(yield* nativePromise(data.text(data.paths.game)), external);
    })
);

test.effect("edit journal cannot replace content outside its validated field intent", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const fs = new FailureFileSystem();
    fs.failReplace = true;
    const adapter = workspaceConfiguration({ managementFileSystem: fs });
    const operationId = uuidv7();
    assert.equal(
      (yield* adapter.edit({
        root: data.root,
        operationId,
        expectedRevision: (yield* data.read()).revision,
        change: {
          kind: "metadata.replace",
          target: { kind: RecordKind.Game, recordId: data.game.id },
          metadata: { title: "Approved" }
        }
      })).status,
      EditStatus.RecoveryRequired
    );
    const path = join(data.root, ".konogame/recovery/edit/journal.json");
    const journal = JSON.parse(yield* nativePromise(readFile(path, "utf8"))) as { after: string };
    journal.after = journal.after.replace("Synthetic game", "Unapproved uniformName");
    yield* nativePromise(writeFile(path, JSON.stringify(journal)));
    const before = yield* nativePromise(data.text(data.paths.game));
    const recovered = yield* adapter.recoverEdit({
      root: data.root,
      operationId
    });
    assert.equal(recovered.status, EditStatus.RecoveryRequired);
    assert.equal(yield* nativePromise(data.text(data.paths.game)), before);
  })
);

test.effect(
  "edit recovery rejects external changes, and pending edits block rename and import",
  () =>
    Effect.gen(function* () {
      const data = yield* nativePromise(fixture());
      const fs = new FailureFileSystem();
      fs.failReplace = true;
      const adapter = workspaceConfiguration({ managementFileSystem: fs });
      const operationId = uuidv7();
      const originalRevision = (yield* data.read()).revision;
      assert.equal(
        (yield* adapter.edit({
          root: data.root,
          operationId,
          expectedRevision: originalRevision,
          change: {
            kind: "metadata.replace",
            target: { kind: RecordKind.Game, recordId: data.game.id },
            metadata: { title: "Updated" }
          }
        })).status,
        EditStatus.RecoveryRequired
      );
      assert.equal(
        (yield* adapter.rename({
          root: data.root,
          operationId: uuidv7(),
          expectedRevision: originalRevision,
          recordId: data.game.id,
          uniformName: "Renamed"
        })).status,
        "recovery-required"
      );
      assert.equal(
        (yield* adapter.import({
          root: data.root,
          operationId: uuidv7(),
          expectedRevision: originalRevision,
          games: [],
          installations: []
        })).status,
        "recovery-required"
      );
      const external = `${yield* nativePromise(data.text(data.paths.game))}# external\n`;
      yield* nativePromise(data.writeText(data.paths.game, external));
      const recovered = yield* adapter.recoverEdit({
        root: data.root,
        operationId
      });
      assert.equal(recovered.status, EditStatus.RecoveryRequired);
      assert.equal(yield* nativePromise(data.text(data.paths.game)), external);
    })
);

test.effect("stale revisions, live locks and strict caller input never alter records", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const input = {
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "metadata.replace" as const,
        target: { kind: RecordKind.Workspace, recordId: data.workspace.id },
        metadata: { name: "Updated" }
      }
    };
    yield* nativePromise(
      data.writeText(
        "workspace.toml",
        `${yield* nativePromise(data.text("workspace.toml"))}# external\n`
      )
    );
    assert.equal((yield* data.adapter.edit(input)).status, EditStatus.Conflict);
    const current = yield* nativePromise(data.text("workspace.toml"));
    yield* nativePromise(
      mkdir(join(data.root, ".konogame/recovery/rename"), {
        recursive: true
      })
    );
    yield* nativePromise(
      writeFile(
        join(data.root, ".konogame/recovery/rename/writer.lock"),
        JSON.stringify({ pid: process.pid, token: uuidv7() })
      )
    );
    assert.equal(
      (yield* data.adapter.edit({
        ...input,
        expectedRevision: (yield* data.read()).revision
      })).status,
      EditStatus.Conflict
    );
    assert.equal(
      (yield* data.adapter.edit({ ...input, root: "relative" })).status,
      EditStatus.Failed
    );
    assert.equal(
      (yield* data.adapter.edit({
        ...input,
        unknown: "reject"
      } as typeof input)).status,
      EditStatus.Failed
    );
    assert.equal(yield* nativePromise(data.text("workspace.toml")), current);
  })
);

test.effect("accepted unchanged edits consume operation IDs and reject another intent", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const input = {
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "metadata.replace" as const,
        target: { kind: RecordKind.Workspace, recordId: data.workspace.id },
        metadata: { name: data.workspace.name }
      }
    };
    const before = yield* nativePromise(data.text("workspace.toml"));
    assert.equal((yield* data.adapter.edit(input)).status, EditStatus.Unchanged);
    assert.equal((yield* data.adapter.edit(input)).status, EditStatus.Unchanged);
    assert.equal(
      (yield* data.adapter.recoverEdit({
        root: input.root,
        operationId: input.operationId
      })).status,
      EditStatus.Unchanged
    );
    const reused = yield* data.adapter.edit({
      ...input,
      change: { ...input.change, metadata: { name: "Different intent" } }
    });
    assert.equal(reused.status, EditStatus.Conflict, reused.reason!);
    assert.equal(yield* nativePromise(data.text("workspace.toml")), before);
  })
);

test.effect("edits preserve the longest legal flat record filename", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const uniformName = "a".repeat(213);
    const path = `games/${recordFileKey(data.game.id, uniformName, ".toml")}`;
    assert.equal(path.slice("games/".length).length, 255);
    yield* nativePromise(data.write(path, { ...data.game, uniformName }));
    yield* nativePromise(unlink(join(data.root, ".konogame", data.paths.game)));
    const result = yield* data.adapter.edit({
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "metadata.replace",
        target: { kind: RecordKind.Game, recordId: data.game.id },
        metadata: { title: "Changed" }
      }
    });
    assert.equal(result.status, EditStatus.Edited, result.reason!);
    assert.equal((yield* data.read()).games[0]?.uniformName, uniformName);
    assert.equal((yield* data.read()).games[0]?.title, "Changed");
  })
);

test.effect("a failure after journal publication remains explicitly recoverable", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const fs = new FailureFileSystem();
    fs.failAfterJournal = true;
    const adapter = workspaceConfiguration({ managementFileSystem: fs });
    const operationId = uuidv7();
    const result = yield* adapter.edit({
      root: data.root,
      operationId,
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "metadata.replace",
        target: { kind: RecordKind.Workspace, recordId: data.workspace.id },
        metadata: { name: "Recovered" }
      }
    });
    assert.equal(result.status, EditStatus.RecoveryRequired, result.reason!);
    assert.equal(
      (yield* adapter.recoverEdit({ root: data.root, operationId })).status,
      EditStatus.Edited
    );
  })
);

test.effect("lock cleanup failure reports recovery after the record was published", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const fs = new FailureFileSystem();
    fs.failLockCleanup = true;
    const adapter = workspaceConfiguration({ managementFileSystem: fs });
    const result = yield* adapter.edit({
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "metadata.replace",
        target: { kind: RecordKind.Workspace, recordId: data.workspace.id },
        metadata: { name: "Published" }
      }
    });
    assert.equal(result.status, EditStatus.RecoveryRequired, result.reason!);
    assert.match(result.reason!, /may already be published.*lock cleanup failed/);
    assert.equal((yield* data.read()).workspace.name, "Published");
  })
);

test.effect("simultaneous operation and lock cleanup failures retain both reasons", () =>
  Effect.gen(function* () {
    const data = yield* nativePromise(fixture());
    const fs = new FailureFileSystem();
    fs.failReplace = true;
    fs.failLockCleanup = true;
    const adapter = workspaceConfiguration({ managementFileSystem: fs });
    const result = yield* adapter.edit({
      root: data.root,
      operationId: uuidv7(),
      expectedRevision: (yield* data.read()).revision,
      change: {
        kind: "metadata.replace",
        target: { kind: RecordKind.Workspace, recordId: data.workspace.id },
        metadata: { name: "Updated" }
      }
    });
    assert.equal(result.status, EditStatus.RecoveryRequired);
    assert.match(result.reason!, /Injected replacement failure.*Injected lock cleanup failure/);
  })
);
