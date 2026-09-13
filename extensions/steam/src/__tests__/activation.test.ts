import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import {
  type DiscoveryFileSystem,
  FILESYSTEM_SAVE_STORE,
  filesystemExtensionSource,
  GAME_DISCOVERY_FILESYSTEM
} from "@konogame/extension-filesystem/providers";
import { gameDiscoveryImplementation, gameModule, gameModuleSource } from "@konogame/game";
import {
  ADAPTER_RESOLVER,
  EXTENSION_LIFECYCLE,
  EXTENSION_REGISTRY,
  provideInfrastructure
} from "@konogame/infrastructure";
import { type SaveStorePort, saveModuleSource } from "@konogame/save";
import { Context, Effect, Layer } from "effect";
import { vi } from "vitest";
import { steamManifest } from "../manifest.ts";
import { steamExtensionSource } from "../providers.ts";

const loaded = vi.hoisted(() => ({ filesystem: 0, steam: 0 }));
vi.mock("@konogame/extension-filesystem", async (original) => {
  loaded.filesystem++;
  return original();
});
vi.mock("../index.ts", async (original) => {
  loaded.steam++;
  return original();
});

it.effect(
  "loads selected Steam discovery after its filesystem dependency and shares the same typed I/O service",
  () =>
    Effect.gen(function* () {
      const paths: string[] = [];
      const fileSystem: DiscoveryFileSystem = {
        inspect: (path) =>
          Effect.sync(() => {
            paths.push(path);
            return { kind: "directory", size: 0, identity: path };
          }),
        list: (path) =>
          Effect.sync(() => {
            paths.push(path);
            return [];
          }),
        readText: () => Effect.die(new Error("Unexpected manifest read"))
      };
      const store: SaveStorePort = {
        put: () => Effect.die(new Error("Unexpected store")),
        open: () => Effect.die(new Error("Unexpected open"))
      };
      expect(steamManifest.contributes.adapters).toHaveLength(1);
      const overrides = Layer.merge(
        Layer.succeed(GAME_DISCOVERY_FILESYSTEM, fileSystem),
        Layer.succeed(FILESYSTEM_SAVE_STORE, store)
      );
      const services = yield* Layer.build(
        provideInfrastructure({}, [
          gameModuleSource(),
          saveModuleSource(),
          filesystemExtensionSource({ saveRoot: resolve("synthetic-unwritten-save-root") }),
          steamExtensionSource()
        ]).pipe(Layer.provideMerge(overrides))
      );
      const lifecycle = Context.get(services, EXTENSION_LIFECYCLE),
        adapterResolver = Context.get(services, ADAPTER_RESOLVER);
      yield* lifecycle.ready;
      expect(loaded).toEqual({ filesystem: 0, steam: 0 });
      const plan = yield* adapterResolver.resolve([
        { feature: gameModule.features[0]!, additionalCapabilities: ["discovery.source.steam"] }
      ]);
      expect(plan.unavailable).toEqual([]);
      expect(plan.resolvedAdapters[0]?.adapterId).toBe("steam.game-discovery");
      expect(loaded).toEqual({ filesystem: 1, steam: 1 });
      expect(Context.get(services, GAME_DISCOVERY_FILESYSTEM)).toBe(fileSystem);
      expect(Context.get(services, EXTENSION_REGISTRY).get("konogame.filesystem")!.activation).toBe(
        "active"
      );
      const result = yield* adapterResolver
        .implementation(plan.resolvedAdapters[0]!, gameDiscoveryImplementation)
        .discover({
          hostId: "synthetic",
          sourceId: "steam",
          sourceKind: "steam",
          scope: { paths: [resolve("synthetic-unwritten-steam-library")], maxDepth: 1, exclude: [] }
        });
      expect(result.diagnostics).toEqual([]);
      expect(paths.some((path) => path.includes("steamapps"))).toBe(true);
    })
);
