import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { UuidIdService } from "@konogame/infrastructure";
import { type ImportConfigurationInput, ImportStatus, recordFileKey } from "@konogame/workspace";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { NodeWorkspaceImportFileSystem } from "../../src/filesystem/import.ts";
import { NodeWorkspaceFileSystem, WorkspaceFileSystemError } from "../../src/filesystem/node.ts";
import { nativePromise } from "../support/effects.ts";
import { fixture, locationBehavior, workspaceConfiguration } from "../support/workspace-fixture.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function setup(layout: "flat" | "directory" = "flat") {
  return Effect.gen(function* () {
    const f = yield* nativePromise(fixture(layout));
    roots.push(f.root);
    const game = {
      ...f.game,
      id: uuidv7(),
      uniformName: "Imported game",
      title: "Imported game",
      externalRefs: [],
      externalIdentities: [
        { issuer: "synthetic.catalog", purpose: "game" as const, value: "product:42" }
      ]
    };
    const installation = {
      ...f.installation,
      id: uuidv7(),
      gameId: game.id,
      uniformName: "Imported installation",
      location: {
        type: "fixture.location",
        schemaVersion: "1.0.0",
        data: { key: "imported" }
      },
      launchEntries: [],
      externalIdentities: [
        { issuer: "synthetic.catalog", purpose: "installation" as const, value: "object:sample" }
      ]
    };
    const input: ImportConfigurationInput = {
      root: f.root,
      expectedRevision: (yield* f.read()).revision,
      operationId: uuidv7(),
      games: [game],
      installations: [installation]
    };
    return { ...f, input };
  });
}
class FailInstallationOnce extends NodeWorkspaceImportFileSystem {
  constructor() {
    super(new NodeWorkspaceFileSystem(), new UuidIdService());
  }

  private fail = true;
  override create(path: string, content: string) {
    const supercreate = super.create.bind(this);
    return Effect.gen({ self: this }, function* () {
      if (
        this.fail &&
        path.replaceAll("\\", "/").includes("/installations/") &&
        path.endsWith(".toml")
      ) {
        this.fail = false;
        return yield* Effect.fail(
          WorkspaceFileSystemError.from(
            "injected-test-failure",
            new Error("Synthetic installation publication failure")
          )
        );
      }
      return yield* supercreate(path, content);
    });
  }
}
describe("Workspace additive import and recovery", () => {
  it.effect.each(["flat", "directory"] as const)(
    "adds a valid Game/Installation in %s layout and preserves original bytes",
    (layout) =>
      Effect.gen(function* () {
        const f = yield* setup(layout);
        yield* nativePromise(
          f.writeText(
            f.paths.game,
            `# Preserve this comment\n${yield* nativePromise(f.text(f.paths.game))}`
          )
        );
        f.input.expectedRevision = (yield* f.read()).revision;
        const before = yield* nativePromise(
          Promise.all(
            [f.paths.game, f.paths.host, f.paths.installation, "workspace.toml"].map((path) =>
              f.text(path)
            )
          )
        );
        const adapter = workspaceConfiguration({ locationBehavior });
        expect((yield* adapter.import(f.input)).status).toBe(ImportStatus.Imported);
        const state = yield* f.read();
        expect(
          state.games.find((game) => game.id === f.input.games[0]!.id)?.externalIdentities
        ).toEqual(f.input.games[0]!.externalIdentities);
        expect(
          state.installations.find(
            (installation) => installation.id === f.input.installations[0]!.id
          )?.externalIdentities
        ).toEqual(f.input.installations[0]!.externalIdentities);
        expect(state.games.map((game) => game.id)).toContain(f.input.games[0]!.id);
        expect(state.installations.map((installation) => installation.id)).toContain(
          f.input.installations[0]!.id
        );
        const key = recordFileKey(f.input.games[0]!.id, "Imported game");
        expect(
          yield* nativePromise(
            f.text(layout === "flat" ? `games/${key}.toml` : `games/${key}/game.toml`)
          )
        ).toContain("Imported game");
        expect(
          yield* nativePromise(
            Promise.all(
              [f.paths.game, f.paths.host, f.paths.installation, "workspace.toml"].map((path) =>
                f.text(path)
              )
            )
          )
        ).toEqual(before);
        expect((yield* adapter.import(f.input)).status).toBe(ImportStatus.Unchanged);
        expect(
          (yield* adapter.import({
            ...f.input,
            games: [{ ...f.input.games[0]!, title: "Changed" }]
          })).status
        ).toBe(ImportStatus.Conflict);
      })
  );

  it.effect("rejects stale revisions and direct physical location aliases across sources", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const adapter = workspaceConfiguration({ locationBehavior });
      expect((yield* adapter.import({ ...f.input, expectedRevision: "stale" })).status).toBe(
        ImportStatus.Conflict
      );
      const host = {
        ...f.host,
        sources: [
          ...f.host.sources,
          { id: "second", kind: "standalone", status: "configured" as const }
        ]
      };
      yield* nativePromise(f.write(f.paths.host, host));
      f.input.expectedRevision = (yield* f.read()).revision;
      f.input.installations[0] = {
        ...f.input.installations[0]!,
        sourceId: "second",
        location: {
          type: "fixture.location",
          schemaVersion: "1.0.0",
          data: { key: "synthetic" }
        }
      };
      expect((yield* adapter.import(f.input)).status).toBe(ImportStatus.Conflict);
      expect((yield* f.read()).games).toHaveLength(1);
    })
  );

  it.effect.each(["flat", "directory"] as const)(
    "exposes a recoverable partial %s import, blocks rename, then finishes only its pending operation",
    (layout) =>
      Effect.gen(function* () {
        const f = yield* setup(layout);
        const faulted = workspaceConfiguration({
          locationBehavior,
          importFileSystem: new FailInstallationOnce()
        });
        expect((yield* faulted.import(f.input)).status).toBe(ImportStatus.RecoveryRequired);
        const adapter = workspaceConfiguration({ locationBehavior });
        expect(
          (yield* adapter.rename({
            root: f.root,
            operationId: uuidv7(),
            recordId: f.game.id,
            uniformName: "Blocked rename",
            expectedRevision: f.input.expectedRevision
          })).status
        ).toBe("recovery-required");
        expect(
          (yield* adapter.recoverImport({
            root: f.root,
            operationId: uuidv7()
          })).status
        ).toBe(ImportStatus.RecoveryRequired);
        expect(
          (yield* adapter.recoverImport({
            root: f.root,
            operationId: f.input.operationId
          })).status
        ).toBe(ImportStatus.Imported);
        const recovered = yield* f.read();
        expect(recovered.installations).toHaveLength(2);
        expect(
          recovered.games.find((game) => game.id === f.input.games[0]!.id)?.externalIdentities
        ).toEqual(f.input.games[0]!.externalIdentities);
        expect(
          recovered.installations.find(
            (installation) => installation.id === f.input.installations[0]!.id
          )?.externalIdentities
        ).toEqual(f.input.installations[0]!.externalIdentities);
        expect(
          (yield* adapter.recoverImport({
            root: f.root,
            operationId: f.input.operationId
          })).status
        ).toBe(ImportStatus.Unchanged);
        expect(
          (yield* adapter.recoverImport({
            root: f.root,
            operationId: uuidv7()
          })).status
        ).toBe(ImportStatus.Failed);
      })
  );

  it.effect("preserves external edits during recovery and reports the pending operation", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const adapter = workspaceConfiguration({
        locationBehavior,
        importFileSystem: new FailInstallationOnce()
      });
      expect((yield* adapter.import(f.input)).status).toBe(ImportStatus.RecoveryRequired);
      const content = `# External edit\n${yield* nativePromise(f.text(f.paths.game))}`;
      yield* nativePromise(f.writeText(f.paths.game, content));
      const result = yield* workspaceConfiguration({
        locationBehavior
      }).recoverImport({
        root: f.root,
        operationId: f.input.operationId
      });
      expect(result.status).toBe(ImportStatus.RecoveryRequired);
      expect(result.reason).toContain("Existing record changed");
      expect(yield* nativePromise(f.text(f.paths.game))).toBe(content);
    })
  );

  it.effect(
    "shares the rename lock, refuses pending rename and never follows internal linked containers",
    () =>
      Effect.gen(function* () {
        const f = yield* setup();
        const adapter = workspaceConfiguration({ locationBehavior });
        const rename = join(f.root, ".konogame/recovery/rename");
        yield* nativePromise(mkdir(rename, { recursive: true }));
        yield* nativePromise(
          writeFile(
            join(rename, "writer.lock"),
            JSON.stringify({ pid: process.pid, token: "synthetic" })
          )
        );
        expect((yield* adapter.import(f.input)).status).toBe(ImportStatus.Conflict);
        yield* nativePromise(rm(join(rename, "writer.lock")));
        yield* nativePromise(writeFile(join(rename, "journal.json"), "{}"));
        expect((yield* adapter.import(f.input)).status).toBe(ImportStatus.RecoveryRequired);
        yield* nativePromise(rm(join(rename, "journal.json")));
        const host = {
          ...f.host,
          id: uuidv7(),
          uniformName: "Empty host",
          gameOverrides: {}
        };
        yield* nativePromise(
          f.write(`local/${recordFileKey(host.id, host.uniformName, ".toml")}`, host)
        );
        const outside = join(f.root, "synthetic-outside");
        yield* nativePromise(mkdir(outside));
        const container = join(f.root, ".konogame/local", recordFileKey(host.id, host.uniformName));
        yield* nativePromise(symlink(outside, container, "junction"));
        expect(
          (yield* adapter.import({
            ...f.input,
            installations: [{ ...f.input.installations[0]!, hostId: host.id }]
          })).status
        ).toBe(ImportStatus.Failed);
      })
  );

  it.effect("accepts an explicitly selected root projection after canonicalizing its target", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const link = `${f.root}-projection`;
      roots.push(link);
      yield* nativePromise(symlink(f.root, link, "junction"));
      const result = yield* workspaceConfiguration({
        locationBehavior
      }).import({
        ...f.input,
        root: link
      });
      expect(result.status).toBe(ImportStatus.Imported);
      expect((yield* f.read()).games).toHaveLength(2);
    })
  );

  it.effect("does not overwrite a target introduced after the revision check", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const target = join(
        f.root,
        ".konogame/games",
        recordFileKey(f.input.games[0]!.id, "Imported game", ".toml")
      );
      class RacingFileSystem extends NodeWorkspaceImportFileSystem {
        constructor() {
          super(new NodeWorkspaceFileSystem(), new UuidIdService());
        }

        override create(path: string, content: string) {
          const supercreate = super.create.bind(this);
          return Effect.gen({ self: this }, function* () {
            if (path === target) {
              yield* nativePromise(writeFile(target, "# Synthetic external content\n"));
            }
            return yield* supercreate(path, content);
          });
        }
      }
      const result = yield* workspaceConfiguration({
        locationBehavior,
        importFileSystem: new RacingFileSystem()
      }).import(f.input);
      expect(result.status).toBe(ImportStatus.RecoveryRequired);
      expect(yield* nativePromise(readFile(target, "utf8"))).toBe("# Synthetic external content\n");
    })
  );

  it.effect(
    "does not recreate an import if its pending journal disappears while recovery acquires the lock",
    () =>
      Effect.gen({ self: this }, function* () {
        const f = yield* setup();
        class FailBeforeFirstRecord extends NodeWorkspaceImportFileSystem {
          constructor() {
            super(new NodeWorkspaceFileSystem(), new UuidIdService());
          }

          override create(path: string, content: string) {
            const supercreate = super.create.bind(this);
            return Effect.gen({ self: this }, function* () {
              if (path.endsWith(".toml")) {
                return yield* Effect.fail(
                  WorkspaceFileSystemError.from(
                    "injected-test-failure",
                    new Error("Synthetic interruption before first record")
                  )
                );
              }
              return yield* supercreate(path, content);
            });
          }
        }
        expect(
          (yield* workspaceConfiguration({
            locationBehavior,
            importFileSystem: new FailBeforeFirstRecord()
          }).import(f.input)).status
        ).toBe(ImportStatus.RecoveryRequired);
        class RemoveJournalBeforeLock extends NodeWorkspaceImportFileSystem {
          constructor() {
            super(new NodeWorkspaceFileSystem(), new UuidIdService());
          }

          override create(path: string, content: string) {
            const supercreate = super.create.bind(this);
            return Effect.gen({ self: this }, function* () {
              if (path.endsWith("writer.lock")) {
                yield* this.remove(join(f.root, ".konogame/recovery/import/journal.json"));
              }
              return yield* supercreate(path, content);
            });
          }
        }
        const result = yield* workspaceConfiguration({
          locationBehavior,
          importFileSystem: new RemoveJournalBeforeLock()
        }).recoverImport({ root: f.root, operationId: f.input.operationId });
        expect(result.status).toBe(ImportStatus.Failed);
        expect(result.reason).toContain("no new operation");
        expect((yield* f.read()).games).toHaveLength(1);
      })
  );

  it.effect("serializes concurrent imports with the same writer lock", () =>
    Effect.gen(function* () {
      const f = yield* setup();
      const adapter = workspaceConfiguration({ locationBehavior });
      const results = yield* Effect.all([
        adapter.import(f.input),
        adapter.import({ ...f.input, operationId: uuidv7() })
      ]);
      expect(results.filter((result) => result.status === ImportStatus.Imported)).toHaveLength(1);
      expect(results.filter((result) => result.status === ImportStatus.Conflict)).toHaveLength(1);
      expect((yield* f.read()).installations).toHaveLength(2);
    })
  );

  it.effect(
    "rejects a linked internal configuration root before accessing its journal target",
    () =>
      Effect.gen({ self: this }, function* () {
        const f = yield* setup();
        const selected = join(f.root, "synthetic-linked-workspace");
        yield* nativePromise(mkdir(selected));
        yield* nativePromise(
          symlink(join(f.root, ".konogame"), join(selected, ".konogame"), "junction")
        );
        class TrackingFileSystem extends NodeWorkspaceImportFileSystem {
          constructor() {
            super(new NodeWorkspaceFileSystem(), new UuidIdService());
          }

          reads = 0;
          writes = 0;
          override read(path: string, maxBytes: number) {
            const superread = super.read.bind(this);
            return Effect.gen({ self: this }, function* () {
              this.reads++;
              return yield* superread(path, maxBytes);
            });
          }
          override create(path: string, content: string) {
            const supercreate = super.create.bind(this);
            return Effect.gen({ self: this }, function* () {
              this.writes++;
              return yield* supercreate(path, content);
            });
          }
        }
        const fs = new TrackingFileSystem();
        const adapter = workspaceConfiguration({
          locationBehavior,
          importFileSystem: fs
        });
        expect(
          (yield* adapter.recoverImport({
            root: selected,
            operationId: f.input.operationId
          })).status
        ).toBe(ImportStatus.RecoveryRequired);
        expect(fs.reads).toBe(0);
        expect(fs.writes).toBe(0);
        expect((yield* adapter.import({ ...f.input, root: selected })).status).toBe(
          ImportStatus.Failed
        );
        expect(fs.reads).toBe(0);
        expect(fs.writes).toBe(0);
      })
  );
});
