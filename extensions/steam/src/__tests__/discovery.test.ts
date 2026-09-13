import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { NodeDiscoveryFileSystem } from "@konogame/extension-filesystem";
import { Cause, Effect, Exit, Fiber } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { SteamGameDiscovery } from "../index.ts";
import { steamSourceKind } from "../manifest.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await createTestDirectory(import.meta.dirname, "unit", "steam-discovery");
  roots.push(root);
  const first = join(root, "Steam");
  const second = join(root, "Library");
  const outside = join(root, "Unselected");
  for (const library of [first, second, outside]) {
    await mkdir(join(library, "steamapps", "common"), { recursive: true });
  }
  const manifest = async (
    library: string,
    id: string,
    directory: string,
    extra = "",
    createDirectory = true
  ) => {
    if (createDirectory) {
      await mkdir(join(library, "steamapps", "common", directory), { recursive: true });
    }
    await writeFile(
      join(library, "steamapps", `appmanifest_${id}.acf`),
      `"AppState" { "appid" "${id}" "name" "Synthetic ${id}" "installdir" "${directory}" "StateFlags" "4" ${extra} }`
    );
  };
  return { root, first, second, outside, manifest };
}
const input = (paths: string[]) => ({
  hostId: "host",
  sourceId: "steam",
  sourceKind: steamSourceKind,
  scope: { paths, maxDepth: 1, exclude: [] }
});
describe("Steam local manifests", () => {
  it.live(
    "scans only explicitly selected libraries and reports unselected library references",
    () =>
      Effect.gen(function* () {
        const f = yield* Effect.promise(() => fixture());
        yield* Effect.promise(() => f.manifest(f.first, "101", "Alpha"));
        yield* Effect.promise(() => f.manifest(f.second, "202", "Beta"));
        yield* Effect.promise(() => f.manifest(f.outside, "303", "PrivateSynthetic"));
        yield* Effect.promise(() =>
          writeFile(
            join(f.first, "steamapps/libraryfolders.vdf"),
            `"libraryfolders" { "0" { "path" ${JSON.stringify(f.first)} } "1" { "path" ${JSON.stringify(f.second)} } "2" { "path" ${JSON.stringify(f.outside)} } }`
          )
        );
        class TrackingFileSystem extends NodeDiscoveryFileSystem {
          readonly accessed: string[] = [];
          override inspect(path: string) {
            this.accessed.push(path);
            return super.inspect(path);
          }
        }
        const fs = new TrackingFileSystem();
        const adapter = new SteamGameDiscovery(fs);
        const first = yield* adapter.discover(input([f.first]));
        expect(first.observations.map((candidate) => candidate.title)).toEqual(["Synthetic 101"]);
        expect(
          fs.accessed.some((path) => path.startsWith(f.outside) || path.startsWith(f.second))
        ).toBe(false);
        expect(
          first.diagnostics.filter((diagnostic) => diagnostic.code === "library-outside-scope")
        ).toHaveLength(2);
        const both = yield* adapter.discover(input([f.first, f.second]));
        expect(both.observations).toHaveLength(2);
        expect(both.observations[0]?.externalIdentities).toEqual([
          { issuer: "konogame.steam", purpose: "game", value: "app:202" }
        ]);
        expect(both.observations[0]?.externalRefs[0]).toEqual({
          authority: "steam",
          kind: "app",
          key: { appId: "202" }
        });
        expect(
          both.observations
            .flatMap((candidate) => candidate.evidence)
            .every((evidence) => /^sha256:[0-9a-f]{64}$/.test(evidence.fingerprint))
        ).toBe(true);
      })
  );

  it.live(
    "diagnoses malformed, mismatched, incomplete, missing and escaping installations while retaining valid candidates",
    () =>
      Effect.gen(function* () {
        const f = yield* Effect.promise(() => fixture());
        yield* Effect.promise(() => f.manifest(f.first, "100", "Valid"));
        const apps = join(f.first, "steamapps");
        yield* Effect.promise(() => f.manifest(f.first, "101", "Missing", "", false));
        for (const [fileId, appId, directory, state] of [
          ["102", "999", "Mismatch", "4"],
          ["103", "103", "../escape", "4"],
          ["104", "104", "Partial", "1"],
          ["105", "105", "Overflow", "4294967300"],
          ["4294967296", "4294967296", "InvalidAppId", "4"]
        ]) {
          yield* Effect.promise(() =>
            writeFile(
              join(apps, `appmanifest_${fileId}.acf`),
              `"AppState" { "appid" "${appId}" "name" "Synthetic" "installdir" "${directory}" "StateFlags" "${state}" }`
            )
          );
        }
        yield* Effect.promise(() => writeFile(join(apps, "appmanifest_106.acf"), '"AppState" {'));
        yield* Effect.promise(() =>
          writeFile(join(apps, "appmanifest_107.acf"), "x".repeat(1024 * 1024 + 1))
        );
        const result = yield* new SteamGameDiscovery(new NodeDiscoveryFileSystem()).discover(
          input([f.first])
        );
        expect(result.observations.map((candidate) => candidate.title)).toEqual(["Synthetic 100"]);
        expect(
          result.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-appmanifest")
        ).toHaveLength(8);
      })
  );

  it.live.skipIf(process.platform !== "win32")(
    "deduplicates Windows Steam library case and separator aliases",
    () =>
      Effect.gen(function* () {
        const f = yield* Effect.promise(() => fixture());
        yield* Effect.promise(() => f.manifest(f.first, "100", "Valid"));
        const result = yield* new SteamGameDiscovery(new NodeDiscoveryFileSystem()).discover(
          input([f.first, f.first.toUpperCase().replaceAll("\\", "/"), join(f.first, "steamapps")])
        );
        expect(result.observations).toHaveLength(1);
      })
  );

  it.live("refuses directory junctions and supports cancellation", () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.promise(() => f.manifest(f.first, "100", "Linked", "", false));
      yield* Effect.promise(() =>
        symlink(f.outside, join(f.first, "steamapps/common/Linked"), "junction")
      );
      const adapter = new SteamGameDiscovery(new NodeDiscoveryFileSystem());
      expect((yield* adapter.discover(input([f.first]))).observations).toHaveLength(0);
      const cancelled = yield* Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(adapter.discover(input([f.first])));
        yield* Fiber.interrupt(fiber);
        return yield* Fiber.await(fiber);
      });
      expect(Exit.isFailure(cancelled)).toBe(true);
      if (Exit.isFailure(cancelled)) {
        expect(Cause.hasInterrupts(cancelled.cause)).toBe(true);
      }
    })
  );
});
