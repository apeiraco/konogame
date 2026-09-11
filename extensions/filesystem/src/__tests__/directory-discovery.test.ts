import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { DiscoveryFileSystemError, GameSourceKind } from "@konogame/game";
import { Effect } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { FilesystemGameDiscovery } from "../game-discovery/adapter.ts";
import { NodeDiscoveryFileSystem } from "../game-discovery/io.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const input = (paths: string[], maxDepth: number, exclude: string[] = []) => ({
  hostId: "host",
  sourceId: "manual",
  sourceKind: GameSourceKind.Standalone,
  scope: { paths, maxDepth, exclude }
});
describe("filesystem local directory discovery", () => {
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
        expect(before.candidates.map((candidate) => candidate.title)).toEqual(["Alpha"]);
        expect(before.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["link-skipped"]);
        yield* Effect.promise(() => writeFile(join(selected, "Alpha/changed.txt"), "new evidence"));
        const after = yield* adapter.discover(input([selected], 1, ["Excluded"]));
        expect(after.candidates[0]?.evidence).not.toEqual(before.candidates[0]?.evidence);
        expect((yield* adapter.discover(input([join(selected, "Linked")], 0))).candidates).toEqual(
          []
        );
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
        expect(aliases.candidates).toHaveLength(1);
        const single = yield* adapter.discover(input([root], 0));
        expect(aliases.candidates[0]?.key).toBe(single.candidates[0]?.key);
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
