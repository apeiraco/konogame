import { copyFile, mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { parseMetadata, syncRelease } from "../../src/release.ts";

const repository = resolve(import.meta.dirname, "../../../..");
const fixtures: string[] = [];
afterEach(async () => {
  for (const root of fixtures.splice(0)) await rm(root, { recursive: true, force: true });
});

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "konogame-release-"));
  fixtures.push(root);
  const source = await readFile(join(repository, "konogame-metadata.toml"), "utf8");
  const metadata = parseMetadata(source);
  const files = [
    "konogame-metadata.toml",
    "CHANGELOG.md",
    "docs/zh/CHANGELOG.md",
    ...metadata.core_package.map((item) => item.manifest),
    ...metadata.extension.map((item) => item.manifest)
  ];
  for (const path of files) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await copyFile(join(repository, path), join(root, path));
  }
  for (const path of [metadata.contract.source, ...metadata.extension.map((item) => item.source)])
    await mkdir(dirname(join(root, path)), { recursive: true });
  await mkdir(join(root, "docs/en"), { recursive: true });
  await symlink("../../CHANGELOG.md", join(root, "docs/en/CHANGELOG.md"), "file");
  await syncRelease(root);
  return { root, metadata, source, read: (path: string) => readFile(join(root, path), "utf8") };
}
