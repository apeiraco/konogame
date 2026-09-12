import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { DECLARATION_PROTOCOL_VERSION } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { fixture } from "../../tests/support/release-fixture.ts";
import { checkRelease } from "../release/check.ts";
import { loadMetadata, parseMetadata } from "../release/metadata.ts";
import { notesForRelease } from "../release/notes.ts";
import { syncRelease } from "../release/sync.ts";
import { setReleaseVersion } from "../release/version.ts";

it.effect("metadata sync is idempotent and release checks detect manifest/source drift", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const report = yield* checkRelease(f.root);
    assert.equal(report.version, f.metadata.project.version);
    assert.equal(report.declarationProtocolVersion, f.metadata.declaration_protocol.version);
    assert.equal(report.corePackages, f.metadata.core_package.length);
    assert.deepEqual((yield* syncRelease(f.root)).changed, []);
    const path = f.metadata.core_package[1]!.manifest;
    const data = JSON.parse(yield* Effect.promise(() => f.read(path)));
    data.version = "9.9.9";
    yield* Effect.promise(() => writeFile(join(f.root, path), JSON.stringify(data)));
    yield* rejects(checkRelease(f.root), /metadata drift/);
    assert.ok((yield* syncRelease(f.root)).changed.includes(path));
    yield* Effect.promise(() =>
      writeFile(
        join(f.root, f.metadata.declaration_protocol.source),
        "// stale generated version\n"
      )
    );
    yield* rejects(checkRelease(f.root), /metadata drift/);
    yield* syncRelease(f.root);
    yield* checkRelease(f.root);
  }).pipe(Effect.provide(NodeFileSystem.layer))
);

it.effect("a host Port version update preserves published Extension Adapter ranges", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const paths = f.metadata.extension.flatMap((extension) => [
      extension.manifest,
      extension.source
    ]);
    const before = yield* Effect.promise(() => Promise.all(paths.map(f.read)));
    const next = f.source.replace(
      /(id = "game.discovery"\r?\nversion = )"0.3.0"(\r?\nsupported_range = )">=0.3.0 <0.4.0"/,
      '$1"0.4.0"$2">=0.4.0 <0.5.0"'
    );
    assert.notEqual(next, f.source);
    yield* Effect.promise(() => writeFile(join(f.root, "konogame-metadata.toml"), next));
    const result = yield* syncRelease(f.root);
    assert.deepEqual(result.changed, ["packages/game/src/version.ts"]);
    assert.deepEqual(yield* Effect.promise(() => Promise.all(paths.map(f.read))), before);
    const report = yield* checkRelease(f.root);
    assert.equal(report.ports.find((port) => port.id === "game.discovery")!.version, "0.4.0");
    assert.equal(report.ports.find((port) => port.id === "save.store")!.version, "0.2.0");
    yield* Effect.promise(() =>
      writeFile(join(f.root, "packages/game/src/version.ts"), "// stale\n")
    );
    yield* rejects(checkRelease(f.root), /metadata drift/);
  }).pipe(Effect.provide(NodeFileSystem.layer))
);

it.effect(
  "core and Extension version updates are independent, preserve metadata comments, and dry-run/invalid versions leave files unchanged",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      assert.match(yield* notesForRelease({ root: f.root, language: "zh" }), /新增/);
      yield* rejects(
        notesForRelease({ root: f.root, language: "missing" }),
        /Unknown changelog language/
      );

      const managedPaths = [
        "konogame-metadata.toml",
        f.metadata.declaration_protocol.source,
        ...f.metadata.core_package.map((item) => item.manifest),
        ...f.metadata.extension.flatMap((item) => [item.manifest, item.source])
      ];
      const untouchedBefore = yield* Effect.promise(() => Promise.all(managedPaths.map(f.read)));
      assert.ok(
        (yield* setReleaseVersion("0.1.0-alpha.2", { root: f.root, dryRun: true })).changed.length
      );
      assert.ok(
        (yield* setReleaseVersion("0.2.0", {
          root: f.root,
          extensionId: f.metadata.extension[0]!.id,
          dryRun: true
        })).changed.length
      );
      yield* rejects(setReleaseVersion("latest", { root: f.root }), /exact SemVer/);
      yield* rejects(setReleaseVersion("v1.0.0", { root: f.root }), /exact SemVer/);
      yield* rejects(
        setReleaseVersion("1.0.0", { root: f.root, extensionId: "missing" }),
        /Unknown Extension/
      );
      assert.deepEqual(
        yield* Effect.promise(() => Promise.all(managedPaths.map(f.read))),
        untouchedBefore
      );

      const extension = f.metadata.extension[0]!;
      const extensionBefore = yield* Effect.promise(() => f.read(extension.manifest));
      const descriptorBefore = yield* Effect.promise(() => f.read(extension.source));
      yield* setReleaseVersion("0.1.0-alpha.1", { root: f.root });
      for (const item of f.metadata.core_package) {
        assert.equal(
          JSON.parse(yield* Effect.promise(() => f.read(item.manifest))).version,
          "0.1.0-alpha.1"
        );
      }
      assert.equal(yield* Effect.promise(() => f.read(extension.manifest)), extensionBefore);
      assert.equal(yield* Effect.promise(() => f.read(extension.source)), descriptorBefore);
      assert.ok(
        (yield* Effect.promise(() => f.read("konogame-metadata.toml"))).includes(
          "# Protocol versions evolve separately"
        )
      );
      assert.equal(
        (yield* loadMetadata(f.root)).declaration_protocol.version,
        DECLARATION_PROTOCOL_VERSION
      );
      yield* rejects(checkRelease(f.root), /exact changelog section/);
      const coreBefore = yield* Effect.promise(() =>
        Promise.all(f.metadata.core_package.map((item) => f.read(item.manifest)))
      );
      yield* setReleaseVersion("0.2.0-alpha.0", { root: f.root, extensionId: extension.id });
      assert.equal(
        JSON.parse(yield* Effect.promise(() => f.read(extension.manifest))).version,
        "0.2.0-alpha.0"
      );
      assert.ok(
        (yield* Effect.promise(() => f.read(extension.source))).includes(
          '"version": "0.2.0-alpha.0"'
        )
      );
      assert.deepEqual(
        yield* Effect.promise(() =>
          Promise.all(f.metadata.core_package.map((item) => f.read(item.manifest)))
        ),
        coreBefore
      );
    }).pipe(Effect.provide(NodeFileSystem.layer))
);

it.effect(
  "release metadata rejects invalid compatibility declarations, missing workspace ownership, and escaped/symlink paths",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      assert.throws(
        () =>
          parseMetadata(
            f.source.replace('supported_range = ">=0.2.0 <0.3.0"', 'supported_range = "latest"')
          ),
        /SemVer range/
      );
      assert.throws(
        () =>
          parseMetadata(
            f.source.replace(
              'declaration_protocol_range = ">=0.2.0 <0.3.0"',
              'declaration_protocol_range = ">=2.0.0"'
            )
          ),
        /excludes/
      );
      for (const marker of ["latest", "generic", ">=26 <27"]) {
        assert.equal(
          parseMetadata(f.source.replace('node = ">=26"', `node = "${marker}"`)).extension[0]!
            .software.node,
          marker
        );
      }
      assert.throws(
        () => parseMetadata(f.source.replace('node = ">=26"', 'node = "unknown-marker"')),
        /SemVer range, latest, or generic/
      );
      yield* Effect.promise(() =>
        mkdir(join(f.root, "packages/unregistered"), { recursive: true })
      );
      yield* Effect.promise(() =>
        writeFile(join(f.root, "packages/unregistered/package.json"), '{"name":"unregistered"}')
      );
      yield* rejects(checkRelease(f.root), /inventory/);
      yield* Effect.promise(() =>
        rm(join(f.root, "packages/unregistered"), { recursive: true, force: true })
      );

      const first = f.metadata.core_package[0]!.manifest;
      const before = yield* Effect.promise(() => f.read(first));
      yield* Effect.promise(() =>
        writeFile(join(f.root, f.metadata.extension[0]!.manifest), '{"name":"wrong"}')
      );
      yield* rejects(syncRelease(f.root), /Package name mismatch/);
      assert.equal(yield* Effect.promise(() => f.read(first)), before);
      yield* Effect.promise(() =>
        writeFile(
          join(f.root, "konogame-metadata.toml"),
          f.source.replace('manifest = "apps/cli/package.json"', 'manifest = "../package.json"')
        )
      );
      yield* rejects(syncRelease(f.root), /repository-relative/);
      yield* Effect.promise(() => writeFile(join(f.root, "konogame-metadata.toml"), f.source));
      yield* Effect.promise(() => rm(join(f.root, "packages/infrastructure/package.json")));
      yield* Effect.promise(() =>
        symlink(
          "../../../package.json",
          join(f.root, "packages/infrastructure/package.json"),
          "file"
        )
      );
      yield* rejects(syncRelease(f.root), /cannot be symlinks/);
    }).pipe(Effect.provide(NodeFileSystem.layer))
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
