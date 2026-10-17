import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Artifact, type ArtifactFile } from "@konogame/contracts";
import { FilesystemSaveStore } from "@konogame/extension-filesystem";
import { test } from "vitest";

test("filesystem stores and reopens multiple streamed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "konogame-test-"));
  try {
    const makeFile = (path: string, parts: string[]): ArtifactFile => ({
      path,
      async *open() {
        for (const part of parts) yield Buffer.from(part);
      }
    });
    const artifact: Artifact = {
      mediaType: "application/test",
      files: (async function* () {
        yield makeFile("slot/a.dat", ["one", "two"]);
        yield makeFile("slot/b.dat", ["three"]);
      })()
    };
    const store = new FilesystemSaveStore(root);
    const reference = await store.put(artifact);
    assert.match(
      reference.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    const reopened = await store.open(reference);
    const paths: string[] = [];
    for await (const file of reopened.files) paths.push(file.path);
    assert.deepEqual(paths, ["slot/a.dat", "slot/b.dat"]);
    assert.equal(
      await readFile(join(root, reference.id, "files", "slot", "a.dat"), "utf8"),
      "onetwo"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("filesystem rejects traversal paths before committing an artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "konogame-test-"));
  try {
    const artifact: Artifact = {
      mediaType: "application/test",
      files: (async function* (): AsyncIterable<ArtifactFile> {
        yield {
          path: "../escape",
          async *open() {
            yield Buffer.from("bad");
          }
        };
      })()
    };
    await assert.rejects(() => new FilesystemSaveStore(root).put(artifact), /Unsafe artifact path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
