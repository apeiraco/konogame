import { join, resolve } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { GameDiscoveryError } from "@konogame/game";
import { Cause, Effect, Exit, Fiber } from "effect";
import { absoluteFilesystemLocation } from "../../location/behavior.ts";
import { filesystemSourceKind } from "../../manifest.ts";
import { FilesystemGameDiscovery } from "../adapter.ts";
import {
  DiscoveryEntryKind,
  type DiscoveryFileSystem,
  DiscoveryFileSystemError
} from "../filesystem.ts";

const root = resolve("synthetic-discovery");
class MemoryDiscoveryFileSystem implements DiscoveryFileSystem {
  private readonly entries = new Map([
    [
      root,
      [
        { name: "Game", kind: DiscoveryEntryKind.Directory },
        { name: "Excluded", kind: DiscoveryEntryKind.Directory },
        { name: "Linked", kind: DiscoveryEntryKind.Link }
      ]
    ],
    [join(root, "Game"), [{ name: "Nested", kind: DiscoveryEntryKind.Directory }]],
    [join(root, "Game", "Nested"), []],
    [join(root, "Excluded"), []]
  ]);
  inspect(path: string) {
    return Effect.succeed({
      kind: path === join(root, "Linked") ? DiscoveryEntryKind.Link : DiscoveryEntryKind.Directory,
      size: 0,
      identity: path
    });
  }
  list(path: string, limit: number) {
    const entries = this.entries.get(path) ?? [];
    return entries.length > limit
      ? Effect.fail(
          new DiscoveryFileSystemError({ operation: "list", message: "Synthetic directory limit" })
        )
      : Effect.succeed(entries);
  }
  readText() {
    return Effect.die(new Error("Directory discovery must not read executable contents"));
  }
}

const input = (maxDepth: number) => ({
  hostId: "host",
  sourceId: "manual",
  sourceKind: filesystemSourceKind,
  scope: { paths: [root], maxDepth, exclude: ["Excluded"] }
});
describe("filesystem game discovery with replaceable I/O", () => {
  it.effect.each([
    { volumeId: "0", objectId: "12" },
    { volumeId: "7", objectId: "0" },
    { volumeId: "", objectId: "12" }
  ])("omits installation identity for unavailable file-object IDs: %j", (fileObject) =>
    Effect.gen(function* () {
      class UnidentifiedFileSystem extends MemoryDiscoveryFileSystem {
        override inspect(path: string) {
          return super.inspect(path).pipe(Effect.map((info) => ({ ...info, fileObject })));
        }
      }
      const result = yield* new FilesystemGameDiscovery(new UnidentifiedFileSystem()).discover(
        input(0)
      );
      expect(result.observations).toHaveLength(1);
      expect(result.observations[0]?.externalIdentities).toBeUndefined();
    })
  );

  it.effect("distinguishes an exact directory from bounded descendant discovery", () =>
    Effect.gen(function* () {
      const adapter = new FilesystemGameDiscovery(new MemoryDiscoveryFileSystem());
      const exact = yield* adapter.discover(input(0));
      expect(exact.observations.map((candidate) => candidate.location)).toEqual([
        absoluteFilesystemLocation(root)
      ]);
      expect(exact.observations[0]?.externalRefs).toEqual([]);
      expect(exact.observations[0]?.externalIdentities).toBeUndefined();
      const shallow = yield* adapter.discover(input(1));
      expect(shallow.observations.map((candidate) => candidate.location)).toEqual([
        absoluteFilesystemLocation(join(root, "Game"))
      ]);
      expect(shallow.diagnostics.map((diagnostic) => diagnostic.code)).toContain("link-skipped");
      expect(
        (yield* adapter.discover(input(2))).observations.map((candidate) => candidate.title)
      ).toEqual(["Game", "Nested"]);
    })
  );

  it.effect("honors cancellation before I/O and rejects unsafe scope options", () =>
    Effect.gen(function* () {
      const adapter = new FilesystemGameDiscovery(new MemoryDiscoveryFileSystem());
      const cancelled = yield* Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(adapter.discover(input(1)));
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      });
      expect(Exit.isFailure(cancelled)).toBe(true);
      if (Exit.isFailure(cancelled)) {
        expect(Cause.hasInterrupts(cancelled.cause)).toBe(true);
      }
      const depthError = yield* Effect.flip(adapter.discover(input(17)));
      expect(depthError).toBeInstanceOf(GameDiscoveryError);
      expect(depthError.message).toContain("maxDepth");
      const exclusionError = yield* Effect.flip(
        adapter.discover({
          ...input(1),
          scope: { paths: [root], maxDepth: 1, exclude: ["../outside"] }
        })
      );
      expect(exclusionError).toBeInstanceOf(GameDiscoveryError);
      expect(exclusionError.message).toContain("relative directory prefix");
    })
  );

  it.effect.each([false, true])(
    "retains the depth budget of overlapping roots in either order (reversed: %s)",
    (reversed) =>
      Effect.gen(function* () {
        const adapter = new FilesystemGameDiscovery(new MemoryDiscoveryFileSystem());
        const paths = [root, join(root, "Game")];
        const result = yield* adapter.discover({
          ...input(1),
          scope: { ...input(1).scope, paths: reversed ? paths.reverse() : paths }
        });
        expect(result.observations.map((candidate) => candidate.title)).toEqual(["Game", "Nested"]);
      })
  );

  it.effect(
    "applies exclusions relative to each explicit root and retains the union of allowed observations",
    () =>
      Effect.gen(function* () {
        const adapter = new FilesystemGameDiscovery(new MemoryDiscoveryFileSystem());
        const result = yield* adapter.discover({
          ...input(1),
          scope: { paths: [root, join(root, "Game")], maxDepth: 1, exclude: ["Game", "Excluded"] }
        });
        expect(result.observations.map((candidate) => candidate.title)).toEqual(["Nested"]);
      })
  );
});
