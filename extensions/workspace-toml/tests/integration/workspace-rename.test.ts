import assert from "node:assert/strict";
import { mkdir, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, it } from "@effect/vitest";
import { RenameStatus, recordFileKey } from "@konogame/workspace";
import { Cause, Deferred, Effect, Fiber, Logger } from "effect";
import { v7 as uuidv7 } from "uuid";
import { NodeWorkspaceFileSystem, WorkspaceFileSystemError } from "../../src/filesystem/node.ts";
import { fixture as rawFixture, workspaceConfiguration } from "../support/workspace-fixture.ts";

const faults = {
  count: 0,
  rename: undefined as undefined | ((from: string, to: string, count: number) => Promise<void>),
  unlink: undefined as undefined | ((path: string) => Promise<void>)
};
class FaultingFileSystem extends NodeWorkspaceFileSystem {
  override move(from: string, to: string) {
    return Effect.tryPromise({
      try: async () => {
        await faults.rename?.(from, to, ++faults.count);
      },
      catch: (cause) => WorkspaceFileSystemError.from("move", cause)
    }).pipe(Effect.andThen(super.move(from, to)));
  }
  override remove(path: string) {
    return Effect.tryPromise({
      try: async () => {
        await faults.unlink?.(path);
      },
      catch: (cause) => WorkspaceFileSystemError.from("unlink", cause)
    }).pipe(Effect.andThen(super.remove(path)));
  }
}
const fixture = (layout?: "flat" | "directory") =>
  rawFixture(layout, { nodeFileSystem: new FaultingFileSystem() });
afterEach(() => {
  faults.rename = undefined;
  faults.unlink = undefined;
  faults.count = 0;
});

const error = () => Object.assign(new Error("Injected filesystem failure"), { code: "EIO" });
const request = (
  f: Awaited<ReturnType<typeof fixture>>,
  uniformName: string,
  recordId = f.game.id
) =>
  Effect.gen(function* () {
    return {
      root: f.root,
      recordId,
      uniformName,
      expectedRevision: (yield* f.read()).revision,
      operationId: uuidv7()
    };
  });

for (const layout of ["flat", "directory"] as const) {
  it.effect(
    `rename preserves ${layout} layout, comments, CRLF, UUID links and original Unicode`,
    () =>
      Effect.gen(function* () {
        const f = yield* Effect.promise(() => fixture(layout));
        yield* Effect.gen(function* () {
          const before = `${(yield* Effect.promise(() => f.text(f.paths.game)))
            .replace(
              '"uniformName" = "Synthetic game"',
              '"uniformName" = """Synthetic game""" # keep comment'
            )
            .replaceAll("\n", "\r\n")}# tail\r\n`;
          yield* Effect.promise(() => f.writeText(f.paths.game, before));
          const name = "Cafe\u0301: \u007f.";
          const result = yield* f.adapter.rename(yield* request(f, name));
          assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
          assert.notEqual(result.revision, undefined);
          const after = yield* f.read();
          assert.equal(after.games[0]?.uniformName, name);
          assert.equal(after.games[0]?.id, f.game.id);
          assert.equal(after.installations[0]?.gameId, f.game.id);
          const target =
            layout === "flat"
              ? `games/${recordFileKey(f.game.id, name, ".toml")}`
              : `games/${recordFileKey(f.game.id, name)}/game.toml`;
          assert.equal(
            yield* Effect.promise(() => f.text(target)),
            before.replace('"""Synthetic game"""', '"Cafe\u0301: \\u007F."')
          );
          assert.equal(
            (yield* f.adapter.rename(yield* request(f, name))).status,
            RenameStatus.Unchanged
          );
          assert.deepEqual(
            yield* Effect.promise(() => readdir(join(f.root, ".konogame", "recovery", "rename"))),
            []
          );
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
            }).pipe(Effect.orDie)
          )
        );
      })
  );
}

for (const layout of ["flat", "directory"] as const) {
  it.effect(
    `Host rename moves ${layout} record and attached installations without editing UUID references`,
    () =>
      Effect.gen(function* () {
        const f = yield* Effect.promise(() => fixture(layout));
        yield* Effect.gen(function* () {
          const original = yield* Effect.promise(() => f.text(f.paths.installation));
          const result = yield* f.adapter.rename(yield* request(f, "Moved host", f.host.id));
          assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
          const movedInstallation = f.paths.installation.replace(
            f.paths.hostContainer,
            `local/${recordFileKey(f.host.id, "Moved host")}`
          );
          assert.equal(yield* Effect.promise(() => f.text(movedInstallation)), original);
          assert.equal((yield* f.read()).installations[0]?.hostId, f.host.id);
        }).pipe(
          Effect.ensuring(
            Effect.gen(function* () {
              yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
            }).pipe(Effect.orDie)
          )
        );
      })
  );
}

it.effect("installation rename preserves its source, location and game/host identities", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      const result = yield* f.adapter.rename(yield* request(f, "Second name", f.installation.id));
      assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
      assert.deepEqual((yield* f.read()).installations[0], {
        ...f.installation,
        uniformName: "Second name"
      });
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }).pipe(Effect.orDie)
      )
    );
  })
);

it.effect("case-only rename works on the real filesystem", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      const result = yield* f.adapter.rename(yield* request(f, "SYNTHETIC GAME"));
      assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
      assert.ok(
        (yield* Effect.promise(() => readdir(join(f.root, ".konogame", "games")))).includes(
          recordFileKey(f.game.id, "SYNTHETIC GAME", ".toml")
        )
      );
      assert.equal((yield* f.read()).games[0]?.uniformName, "SYNTHETIC GAME");
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }).pipe(Effect.orDie)
      )
    );
  })
);

it.effect(
  "explicit rename repairs a manually changed suffix while preserving its original token",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.gen(function* () {
        const content = yield* Effect.promise(() => f.text(f.paths.game));
        yield* Effect.promise(() =>
          rename(
            join(f.root, ".konogame", f.paths.game),
            join(f.root, ".konogame", `games/${f.game.id}-Other.toml`)
          )
        );
        const result = yield* f.adapter.rename(yield* request(f, f.game.uniformName));
        assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
        assert.equal(yield* Effect.promise(() => f.text(f.paths.game)), content);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
          }).pipe(Effect.orDie)
        )
      );
    })
);

it.effect(
  "stale revisions, active writer locks, invalid inputs and occupied targets never overwrite files",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.gen(function* () {
        const input = yield* request(f, "New name");
        const externallyEdited = `${yield* Effect.promise(() => f.text(f.paths.game))}# external\n`;
        yield* Effect.promise(() => f.writeText(f.paths.game, externallyEdited));
        assert.equal((yield* f.adapter.rename(input)).status, RenameStatus.Conflict);
        const valid = yield* request(f, "New name");
        yield* Effect.promise(() =>
          writeFile(
            join(f.root, ".konogame", "recovery/rename/writer.lock"),
            JSON.stringify({ pid: process.pid, token: "other" })
          )
        );
        assert.equal((yield* f.adapter.rename(valid)).status, RenameStatus.Conflict);
        yield* Effect.promise(() => rm(join(f.root, ".konogame", "recovery/rename/writer.lock")));
        const target = `games/${recordFileKey(f.game.id, "New name", ".toml")}`;
        yield* Effect.promise(() => f.writeText(target, "external bytes"));
        assert.equal((yield* f.adapter.rename(valid)).status, RenameStatus.Failed);
        assert.equal(yield* Effect.promise(() => f.text(target)), "external bytes");
        yield* Effect.promise(() => rm(join(f.root, ".konogame", target)));
        assert.equal(
          (yield* f.adapter.rename({ ...valid, uniformName: "界".repeat(100) })).status,
          RenameStatus.Failed
        );
        assert.equal(
          (yield* f.adapter.rename({ ...valid, recordId: uuidv7() })).status,
          RenameStatus.Failed
        );
        assert.equal(
          (yield* f.adapter.rename({ ...valid, recordId: f.workspace.id })).status,
          RenameStatus.Failed
        );
        assert.equal(
          (yield* f.adapter.rename({ ...valid, operationId: "../escape" })).status,
          RenameStatus.Failed
        );
        assert.ok((yield* Effect.promise(() => f.text(f.paths.game))).endsWith("# external\n"));
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
          }).pipe(Effect.orDie)
        )
      );
    })
);

it.effect("failure between moves rolls back safely when filesystem permits it", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      const before = yield* f.read();
      const input = yield* request(f, "New name");
      faults.rename = async (_from, _to, count) => {
        if (count === 2) {
          throw error();
        }
      };
      const result = yield* f.adapter.rename(input);
      assert.equal(result.status, RenameStatus.Failed, result.reason ?? "");
      assert.equal((yield* f.read()).revision, before.revision);
      assert.deepEqual(
        yield* Effect.promise(() => readdir(join(f.root, ".konogame", "recovery/rename"))),
        []
      );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }).pipe(Effect.orDie)
      )
    );
  })
);

it.effect("failure after writing new content restores original content and paths", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      const before = yield* f.read();
      let injected = false;
      faults.unlink = async (path) => {
        if (!injected && path.endsWith("journal.json")) {
          injected = true;
          throw error();
        }
      };
      const result = yield* f.adapter.rename(yield* request(f, "New name"));
      assert.equal(result.status, RenameStatus.Failed, result.reason ?? "");
      assert.equal((yield* f.read()).revision, before.revision);
      assert.deepEqual(
        yield* Effect.promise(() => readdir(join(f.root, ".konogame", "recovery/rename"))),
        []
      );
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }).pipe(Effect.orDie)
      )
    );
  })
);

for (const record of ["game", "host"] as const) {
  it.effect(`interrupted ${record} rename resumes from journal after a staged move`, () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.gen(function* () {
        const id = record === "host" ? f.host.id : f.game.id;
        const input = yield* request(f, "Recovered name", id);
        faults.rename = async (_from, _to, count) => {
          if (count >= (record === "host" ? 4 : 2)) {
            throw error();
          }
        };
        const first = yield* f.adapter.rename(input);
        assert.equal(first.status, RenameStatus.RecoveryRequired, first.reason ?? "");
        assert.ok(
          (yield* Effect.promise(() =>
            readdir(join(f.root, ".konogame", "recovery/rename"))
          )).includes("journal.json")
        );
        faults.rename = undefined;
        const resumed = yield* f.adapter.rename({ ...input, operationId: uuidv7() });
        assert.equal(resumed.status, RenameStatus.Renamed, resumed.reason ?? "");
        const after = yield* f.read();
        assert.equal(
          (record === "host" ? after.hosts : after.games)[0]?.uniformName,
          "Recovered name"
        );
        assert.equal(after.installations.length, 1);
        assert.deepEqual(
          yield* Effect.promise(() => readdir(join(f.root, ".konogame", "recovery/rename"))),
          []
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
          }).pipe(Effect.orDie)
        )
      );
    })
  );
}

it.effect("recovery refuses a different rename and never replaces external edits", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      const input = yield* request(f, "Recovered name");
      faults.rename = async (_from, _to, count) => {
        if (count >= 2) {
          throw error();
        }
      };
      assert.equal((yield* f.adapter.rename(input)).status, RenameStatus.RecoveryRequired);
      faults.rename = undefined;
      assert.equal(
        (yield* f.adapter.rename({ ...input, uniformName: "Different" })).status,
        RenameStatus.RecoveryRequired
      );
      const journal = JSON.parse(
        yield* Effect.promise(() => f.text("recovery/rename/journal.json"))
      ) as {
        moves: { via: string }[];
      };
      const staged = journal.moves[0]!.via;
      const external = `${yield* Effect.promise(() => f.text(staged))}# external edits\n`;
      yield* Effect.promise(() => f.writeText(staged, external));
      assert.equal((yield* f.adapter.rename(input)).status, RenameStatus.RecoveryRequired);
      assert.equal(yield* Effect.promise(() => f.text(staged)), external);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }).pipe(Effect.orDie)
      )
    );
  })
);

it.effect("recovery directories and tampered journal paths cannot escape configuration", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      yield* Effect.promise(() => mkdir(join(f.root, "external")));
      yield* Effect.promise(() =>
        symlink(join(f.root, "external"), join(f.root, ".konogame", "recovery"), "junction")
      );
      assert.equal(
        (yield* f.adapter.rename(yield* request(f, "New"))).status,
        RenameStatus.RecoveryRequired
      );
      assert.deepEqual(yield* Effect.promise(() => readdir(join(f.root, "external"))), []);
      yield* Effect.promise(() => rm(join(f.root, ".konogame", "recovery")));
      const input = yield* request(f, "New");
      faults.rename = async (_from, _to, count) => {
        if (count >= 2) {
          throw error();
        }
      };
      yield* f.adapter.rename(input);
      faults.rename = undefined;
      const journal = JSON.parse(
        yield* Effect.promise(() => f.text("recovery/rename/journal.json"))
      );
      journal.moves[0].to = "../escape";
      yield* Effect.promise(() =>
        f.writeText("recovery/rename/journal.json", JSON.stringify(journal))
      );
      assert.equal((yield* f.adapter.rename(input)).status, RenameStatus.RecoveryRequired);
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
        }).pipe(Effect.orDie)
      )
    );
  })
);

for (const failRollback of [false, true]) {
  it.effect(
    `interruption ${failRollback ? "reports required recovery when rollback fails" : "rolls back owned paths and releases the writer lock"}`,
    () =>
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        class PausingFileSystem extends NodeWorkspaceFileSystem {
          private moves = 0;
          override move(from: string, to: string) {
            return Effect.suspend(() => {
              this.moves++;
              if (this.moves === 2) {
                return Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never));
              }
              if (failRollback && this.moves > 2) {
                return Effect.fail(
                  WorkspaceFileSystemError.from("rollback", "Injected rollback failure")
                );
              }
              return super.move(from, to);
            });
          }
        }
        const f = yield* Effect.promise(() =>
          rawFixture("flat", { nodeFileSystem: new PausingFileSystem() })
        );
        const before = yield* f.read();
        const input = yield* request(f, "After cancellation");
        const diagnostics: unknown[] = [];
        const logger = Logger.make((options) => {
          diagnostics.push(options.message);
        });
        const fiber = yield* f.adapter
          .rename(input)
          .pipe(Effect.provide(Logger.layer([logger])), Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(fiber);
        const exit = yield* Fiber.await(fiber);
        assert.equal(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          assert.ok(Cause.hasInterrupts(exit.cause));
          if (!failRollback) {
            assert.ok(Cause.hasInterruptsOnly(exit.cause));
          }
        }
        assert.equal(diagnostics.length, failRollback ? 1 : 0);
        if (failRollback) {
          assert.match(JSON.stringify(diagnostics), /recovery-required.*rollback failed/);
        }
        const pending = yield* Effect.promise(() =>
          readdir(join(f.root, ".konogame", "recovery/rename"))
        );
        assert.ok(!pending.includes("writer.lock"));
        if (failRollback) {
          assert.ok(pending.includes("journal.json"));
          const recovery = workspaceConfiguration();
          const resumed = yield* recovery.rename({ ...input, operationId: uuidv7() });
          assert.equal(resumed.status, RenameStatus.Renamed, resumed.reason ?? "");
          assert.equal((yield* f.read()).games[0]?.uniformName, "After cancellation");
        } else {
          assert.deepEqual(pending, []);
          assert.equal((yield* f.read()).revision, before.revision);
        }
      })
  );
}

it.effect("interruption preserves a failed writer cleanup for manual recovery", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const diagnostics: unknown[] = [];
    const logger = Logger.make((options) => {
      diagnostics.push(options.message);
    });
    class CleanupFailureFileSystem extends NodeWorkspaceFileSystem {
      private moves = 0;
      override move(from: string, to: string) {
        return Effect.suspend(() =>
          ++this.moves === 2
            ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
            : super.move(from, to)
        );
      }
      override remove(path: string) {
        return path.endsWith("writer.lock")
          ? Effect.fail(
              WorkspaceFileSystemError.from("release-lock", "Injected writer cleanup failure")
            )
          : super.remove(path);
      }
    }
    const f = yield* Effect.promise(() =>
      rawFixture("flat", { nodeFileSystem: new CleanupFailureFileSystem() })
    );
    const before = yield* f.read();
    const input = yield* request(f, "After cancellation");
    const fiber = yield* f.adapter
      .rename(input)
      .pipe(Effect.provide(Logger.layer([logger])), Effect.forkChild);
    yield* Deferred.await(started);
    yield* Fiber.interrupt(fiber);
    const exit = yield* Fiber.await(fiber);
    assert.equal(exit._tag, "Failure");
    if (exit._tag === "Failure") {
      assert.ok(Cause.hasInterrupts(exit.cause));
    }
    assert.equal((yield* f.read()).revision, before.revision);
    assert.deepEqual(
      yield* Effect.promise(() => readdir(join(f.root, ".konogame", "recovery/rename"))),
      ["writer.lock"]
    );
    assert.match(JSON.stringify(diagnostics), /cleanup.*recovery|recovery.*cleanup/i);
    const blocked = yield* workspaceConfiguration().rename(input);
    assert.equal(blocked.status, RenameStatus.Conflict);
  })
);
