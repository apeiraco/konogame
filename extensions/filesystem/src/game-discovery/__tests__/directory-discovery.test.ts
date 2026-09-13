import { mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { createTestDirectory } from "../../../../../tests/support/temp.ts";
import { filesystemSourceKind } from "../../manifest.ts";
import { FilesystemGameDiscovery } from "../adapter.ts";
import { DiscoveryFileSystemError } from "../filesystem.ts";
import { NodeDiscoveryFileSystem } from "../io.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const input = (paths: string[], maxDepth: number, exclude: string[] = []) => ({
  hostId: "host",
  sourceId: "manual",
  sourceKind: filesystemSourceKind,
  scope: { paths, maxDepth, exclude }
});
describe("filesystem local directory discovery", () => {
  it.live("preserves reliable file-object identity through directory edits and moves", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "unit", "game-discovery", "identity")
      );
      roots.push(root);
      const original = join(root, "Original");
      const moved = join(root, "Moved");
      yield* Effect.promise(() => mkdir(original));
      const adapter = new FilesystemGameDiscovery(new NodeDiscoveryFileSystem());
      const before = (yield* adapter.discover(input([original], 0))).observations[0]!;
      expect(before.externalIdentities).toHaveLength(1);
      yield* Effect.promise(() => writeFile(join(original, "changed.txt"), "updated evidence"));
      yield* Effect.promise(() => rename(original, moved));
      const after = (yield* adapter.discover(input([moved], 0))).observations[0]!;
      expect(after.externalIdentities).toEqual(before.externalIdentities);
      expect(after.observationKey).not.toEqual(before.observationKey);
      expect(after.evidence).not.toEqual(before.evidence);
      const anotherHost = (yield* adapter.discover({
        ...input([moved], 0),
        hostId: "another-host"
      })).observations[0]!;
      expect(anotherHost.externalIdentities).not.toEqual(before.externalIdentities);
    })
  );

  it.live(
    "keeps depth and exclusions within explicit roots, skips junctions and observes source changes",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() =>
          createTestDirectory(import.meta.dirname, "unit", "game-discovery", "directory")
        );
        roots.push(root);
        const selected = join(root, "Selected");
        const outside = join(root, "Outside");
        yield* Effect.promise(() => mkdir(join(selected, "Alpha/Nested"), { recursive: true }));
        yield* Effect.promise(() => mkdir(join(selected, "Excluded/Hidden"), { recursive: true }));
        yield* Effect.promise(() => mkdir(outside));
        yield* Effect.promise(() => symlink(outside, join(selected, "Linked"), "junction"));
        yield* Effect.promise(() =>
          writeFile(join(selected, "Alpha/play.exe"), "Synthetic executable data; never executed")
        );
        const adapter = new FilesystemGameDiscovery(new NodeDiscoveryFileSystem());
        const before = yield* adapter.discover(input([selected], 1, ["Excluded"]));
        expect(before.observations.map((candidate) => candidate.title)).toEqual(["Alpha"]);
        expect(before.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["link-skipped"]);
        yield* Effect.promise(() => writeFile(join(selected, "Alpha/changed.txt"), "new evidence"));
        const after = yield* adapter.discover(input([selected], 1, ["Excluded"]));
        expect(after.observations[0]?.evidence).not.toEqual(before.observations[0]?.evidence);
        expect(
          (yield* adapter.discover(input([join(selected, "Linked")], 0))).observations
        ).toEqual([]);
      })
  );

  it.live.skipIf(process.platform !== "win32")(
    "deduplicates Windows scope path case aliases with a stable observation key",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() =>
          createTestDirectory(import.meta.dirname, "unit", "game-discovery", "case")
        );
        roots.push(root);
        const adapter = new FilesystemGameDiscovery(new NodeDiscoveryFileSystem());
        const aliases = yield* adapter.discover(input([root, root.toUpperCase()], 0));
        expect(aliases.observations).toHaveLength(1);
        const single = yield* adapter.discover(input([root], 0));
        expect(aliases.observations[0]?.observationKey).toBe(
          single.observations[0]?.observationKey
        );
      })
  );

  it.live("bounds directory enumeration and manifest reads", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "unit", "game-discovery", "bounded")
      );
      roots.push(root);
      yield* Effect.promise(() => writeFile(join(root, "one.txt"), "12345"));
      yield* Effect.promise(() => writeFile(join(root, "two.txt"), "x"));
      const fs = new NodeDiscoveryFileSystem();
      const listError = yield* Effect.flip(fs.list(root, 1));
      expect(listError).toBeInstanceOf(DiscoveryFileSystemError);
      expect(listError.message).toContain("limit");
      const readError = yield* Effect.flip(fs.readText(join(root, "one.txt"), 4));
      expect(readError).toBeInstanceOf(DiscoveryFileSystemError);
      expect(readError.message).toContain("at most");
      expect(yield* fs.readText(join(root, "one.txt"), 5)).toBe("12345");
    })
  );
});
