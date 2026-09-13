import assert from "node:assert/strict";
import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { fixture } from "../support/workspace-fixture.ts";

for (const layout of ["flat", "directory"] as const) {
  it.effect(`reader loads ${layout} records and preserves identity and opaque metadata`, () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture(layout));
      yield* Effect.gen(function* () {
        const before = yield* f.read();
        assert.equal(before.workspace.id, f.workspace.id);
        assert.equal(before.games[0]?.id, f.game.id);
        assert.equal(before.hosts[0]?.id, f.host.id);
        assert.deepEqual(before.installations[0]?.location, f.installation.location);
        assert.equal((yield* f.read()).revision, before.revision);
        yield* Effect.promise(() =>
          f.write(f.paths.installation, {
            ...f.installation,
            location: { type: "fixture.location", schemaVersion: "1.0.0", data: { key: "moved" } }
          })
        );
        assert.equal((yield* f.read()).installations[0]?.id, f.installation.id);
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
it.effect("UUID is identity, filename suffix is diagnostic, and duplicate records are errors", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.gen(function* () {
      const renamed = `games/${f.game.id}-Human rename.toml`;
      yield* Effect.promise(() =>
        rename(join(f.root, ".konogame", f.paths.game), join(f.root, ".konogame", renamed))
      );
      assert.equal((yield* f.read()).games[0]?.id, f.game.id);
      assert.equal((yield* f.read()).diagnostics?.length, 1);
      const newHostContainer = `local/${f.host.id}-Other suffix`;
      yield* Effect.promise(() =>
        rename(
          join(f.root, ".konogame", f.paths.hostContainer),
          join(f.root, ".konogame", newHostContainer)
        )
      );
      assert.equal((yield* f.read()).installations.length, 1);
      yield* Effect.promise(() => f.write(`games/${f.game.id}-Duplicate/game.toml`, f.game));
      yield* rejects(f.read(), /Duplicate record ID/);
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
  "reader reports incompatible records, dangling references, malformed filenames and symlinks",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.gen(function* () {
        yield* Effect.promise(() =>
          f.write(f.paths.installation, { ...f.installation, gameId: uuidv7() })
        );
        yield* rejects(f.read(), /Unknown game/);
        yield* Effect.promise(() =>
          f.write(f.paths.installation, { ...f.installation, id: uuidv7() })
        );
        yield* rejects(f.read(), /filename mismatch/);
        yield* Effect.promise(() => f.write(f.paths.installation, f.installation));
        yield* Effect.promise(() => f.write("games/bad.toml", f.game));
        yield* rejects(f.read(), /Invalid record filename/);
        yield* Effect.promise(() => rm(join(f.root, ".konogame", "games/bad.toml")));
        yield* Effect.promise(() => writeFile(join(f.root, ".konogame", "workspace.json"), "{}"));
        yield* rejects(f.read(), /Incompatible legacy/);
        yield* Effect.promise(() => rm(join(f.root, ".konogame", "workspace.json")));
        yield* Effect.promise(() =>
          f.write(f.paths.host, { ...f.host, roots: { games: "relative" } })
        );
        assert.equal((yield* f.read()).hosts[0]?.roots.games, "relative");
        yield* Effect.promise(() => f.write(f.paths.host, f.host));
        yield* Effect.promise(() => mkdir(join(f.root, "outside")));
        yield* Effect.promise(() =>
          symlink(join(f.root, "outside"), join(f.root, ".konogame", "games", "link"), "junction")
        );
        yield* rejects(f.read(), /links are forbidden/);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
          }).pipe(Effect.orDie)
        )
      );
    })
);

function rejects<A, E, R>(effect: Effect.Effect<A, E, R>, expected: RegExp) {
  return Effect.gen(function* () {
    const result = yield* Effect.result(effect);
    assert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.match(String(result.failure), expected);
    }
  });
}
