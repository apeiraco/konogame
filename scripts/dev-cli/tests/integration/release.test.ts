import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONTRACT_VERSION } from "@konogame/contracts";
import { test } from "vitest";
import {
  checkRelease,
  loadMetadata,
  notesForRelease,
  parseMetadata,
  setReleaseVersion,
  syncRelease
} from "../../src/release.ts";
import { fixture } from "../support/release-fixture.ts";

test("metadata sync is idempotent and release checks detect manifest/source drift", async () => {
  const f = await fixture();
  const report = await checkRelease(f.root);
  assert.equal(report.version, f.metadata.project.version);
  assert.equal(report.contractVersion, f.metadata.contract.version);
  assert.equal(report.corePackages, f.metadata.core_package.length);
  assert.deepEqual((await syncRelease(f.root)).changed, []);
  const path = f.metadata.core_package[1]!.manifest;
  const data = JSON.parse(await f.read(path));
  data.version = "9.9.9";
  await writeFile(join(f.root, path), JSON.stringify(data));
  await assert.rejects(() => checkRelease(f.root), /metadata drift/);
  assert.ok((await syncRelease(f.root)).changed.includes(path));
  await writeFile(join(f.root, f.metadata.contract.source), "// stale generated version\n");
  await assert.rejects(() => checkRelease(f.root), /metadata drift/);
  await syncRelease(f.root);
  await checkRelease(f.root);
});

test("core and Extension version updates are independent and preserve metadata comments", async () => {
  const f = await fixture();
  const extension = f.metadata.extension[0]!;
  const extensionBefore = await f.read(extension.manifest);
  const descriptorBefore = await f.read(extension.source);
  await setReleaseVersion("0.1.0-alpha.1", { root: f.root });
  for (const item of f.metadata.core_package)
    assert.equal(JSON.parse(await f.read(item.manifest)).version, "0.1.0-alpha.1");
  assert.equal(await f.read(extension.manifest), extensionBefore);
  assert.equal(await f.read(extension.source), descriptorBefore);
  assert.ok(
    (await f.read("konogame-metadata.toml")).includes("# Protocol versions evolve separately")
  );
  assert.equal((await loadMetadata(f.root)).contract.version, CONTRACT_VERSION);
  await assert.rejects(() => checkRelease(f.root), /exact changelog section/);
  const coreBefore = await Promise.all(
    f.metadata.core_package.map((item) => f.read(item.manifest))
  );
  await setReleaseVersion("0.2.0-alpha.0", { root: f.root, extensionId: extension.id });
  assert.equal(JSON.parse(await f.read(extension.manifest)).version, "0.2.0-alpha.0");
  assert.ok((await f.read(extension.source)).includes('"version": "0.2.0-alpha.0"'));
  assert.deepEqual(
    await Promise.all(f.metadata.core_package.map((item) => f.read(item.manifest))),
    coreBefore
  );
});

test("dry-run and invalid versions leave every managed file unchanged", async () => {
  const f = await fixture();
  const paths = [
    "konogame-metadata.toml",
    f.metadata.contract.source,
    ...f.metadata.core_package.map((item) => item.manifest),
    ...f.metadata.extension.flatMap((item) => [item.manifest, item.source])
  ];
  const before = await Promise.all(paths.map(f.read));
  assert.ok(
    (await setReleaseVersion("0.1.0-alpha.2", { root: f.root, dryRun: true })).changed.length
  );
  assert.ok(
    (
      await setReleaseVersion("0.2.0", {
        root: f.root,
        extensionId: f.metadata.extension[0]!.id,
        dryRun: true
      })
    ).changed.length
  );
  await assert.rejects(() => setReleaseVersion("latest", { root: f.root }), /exact SemVer/);
  await assert.rejects(() => setReleaseVersion("v1.0.0", { root: f.root }), /exact SemVer/);
  await assert.rejects(
    () => setReleaseVersion("1.0.0", { root: f.root, extensionId: "missing" }),
    /Unknown Extension/
  );
  assert.deepEqual(await Promise.all(paths.map(f.read)), before);
});

test("release notes select the requested language and reject unknown languages", async () => {
  const f = await fixture();
  assert.match(await notesForRelease({ root: f.root, language: "zh" }), /新增/);
  await assert.rejects(
    () => notesForRelease({ root: f.root, language: "missing" }),
    /Unknown changelog language/
  );
});

test("release metadata rejects invalid compatibility declarations and missing workspace ownership", async () => {
  const f = await fixture();
  assert.throws(
    () =>
      parseMetadata(
        f.source.replace('supported_range = ">=0.1.0 <0.2.0"', 'supported_range = "latest"')
      ),
    /SemVer range/
  );
  assert.throws(
    () =>
      parseMetadata(
        f.source.replace('contract_range = ">=0.1.0 <0.2.0"', 'contract_range = ">=2.0.0"')
      ),
    /excludes/
  );
  for (const marker of ["latest", "generic", ">=26 <27"])
    assert.equal(
      parseMetadata(f.source.replace('node = ">=26"', `node = "${marker}"`)).extension[0]!.software
        .node,
      marker
    );
  assert.throws(
    () => parseMetadata(f.source.replace('node = ">=26"', 'node = "unknown-marker"')),
    /SemVer range, latest, or generic/
  );
  await mkdir(join(f.root, "packages/unregistered"), { recursive: true });
  await writeFile(join(f.root, "packages/unregistered/package.json"), '{"name":"unregistered"}');
  await assert.rejects(() => checkRelease(f.root), /inventory/);
});

test("metadata sync validates every file before changing files and rejects escaped/symlink paths", async () => {
  const f = await fixture();
  const first = f.metadata.core_package[0]!.manifest;
  const before = await f.read(first);
  await writeFile(join(f.root, f.metadata.extension[0]!.manifest), '{"name":"wrong"}');
  await assert.rejects(() => syncRelease(f.root), /Package name mismatch/);
  assert.equal(await f.read(first), before);
  await writeFile(
    join(f.root, "konogame-metadata.toml"),
    f.source.replace('manifest = "apps/cli/package.json"', 'manifest = "../package.json"')
  );
  await assert.rejects(() => syncRelease(f.root), /repository-relative/);
  await writeFile(join(f.root, "konogame-metadata.toml"), f.source);
  await rm(join(f.root, "packages/contracts/package.json"));
  await symlink("../../../package.json", join(f.root, "packages/contracts/package.json"), "file");
  await assert.rejects(() => syncRelease(f.root), /cannot be symlinks/);
});
