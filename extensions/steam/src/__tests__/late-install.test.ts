import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "@effect/vitest";
import {
  type DiscoveryFileSystem,
  GAME_DISCOVERY_FILESYSTEM
} from "@konogame/extension-filesystem";
import { filesystemManifest } from "@konogame/extension-filesystem/manifest";
import { FILESYSTEM_SAVE_STORE } from "@konogame/extension-filesystem/providers";
import { gameDiscoveryImplementation, gameModule, gameModuleSource } from "@konogame/game";
import {
  ADAPTER_RESOLVER,
  defineExtensionModule,
  EXTENSION_LIFECYCLE,
  EXTENSION_REGISTRY,
  provideIdService,
  provideInfrastructure
} from "@konogame/infrastructure";
import { locationImplementation } from "@konogame/infrastructure/contracts";
import { saveModule, saveModuleSource, saveStoreImplementation } from "@konogame/save";
import { Context, Effect, Layer, Stream } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { steamManifest } from "../manifest.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.live(
  "late-installs real filesystem and Steam modules into a core-only process with native generation services",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "unit", "late-install")
      );
      roots.push(root);
      const observed: string[] = [];
      const fileSystem: DiscoveryFileSystem = {
        inspect: (path) =>
          Effect.sync(() => {
            observed.push(path);
            return { kind: "directory", size: 0, identity: path };
          }),
        list: (path) =>
          Effect.sync(() => {
            observed.push(path);
            return [];
          }),
        readText: () => Effect.die(new Error("Unexpected manifest read"))
      };
      const services = yield* Layer.build(
        provideInfrastructure({}, [saveModuleSource(), gameModuleSource()]).pipe(
          Layer.provide(
            provideIdService({
              uuidV7: () => Effect.succeed("01999999-9999-7999-8999-999999999999")
            })
          )
        )
      );
      const lifecycle = Context.get(services, EXTENSION_LIFECYCLE),
        adapterResolver = Context.get(services, ADAPTER_RESOLVER);
      const saveFeature = saveModule.features.find(({ id }) => id === "save.store")!;
      yield* lifecycle.ready;
      expect(Context.getOption(services, FILESYSTEM_SAVE_STORE)._tag).toBe("None");
      expect(Context.getOption(services, GAME_DISCOVERY_FILESYSTEM)._tag).toBe("None");
      expect((yield* adapterResolver.resolve([{ feature: saveFeature }])).unavailable).toHaveLength(
        1
      );
      yield* lifecycle.register([
        {
          kind: "extension",
          manifest: filesystemManifest,
          load: () =>
            Effect.tryPromise(() => import("@konogame/extension-filesystem")).pipe(
              Effect.map((module) => {
                const base = module.createFilesystemExtensionModule({
                  saveRoot: join(root, "saves")
                });
                return defineExtensionModule({
                  layer: Layer.merge(
                    base.layer,
                    Layer.succeed(GAME_DISCOVERY_FILESYSTEM, fileSystem)
                  ),
                  activate: base.activate
                });
              })
            )
        }
      ]);
      const savePlan = yield* adapterResolver.resolve([{ feature: saveFeature }]);
      expect(savePlan.unavailable).toEqual([]);
      const store = adapterResolver.implementation(
        savePlan.resolvedAdapters[0]!,
        saveStoreImplementation
      );
      const content = new TextEncoder().encode("Synthetic late-installed save");
      const reference = yield* store.put({
        mediaType: "application/vnd.synthetic.save",
        files: Stream.succeed({ path: "slot/save.bin", open: () => Stream.succeed(content) })
      });
      expect(reference.id).toBe("01999999-9999-7999-8999-999999999999");
      const reopened = yield* store.open(reference);
      yield* Stream.runForEach(reopened.files, (file) =>
        Effect.gen(function* () {
          expect(file.path).toBe("slot/save.bin");
          const chunks = yield* Stream.runCollect(file.open());
          expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe(
            "Synthetic late-installed save"
          );
        })
      );
      const location = {
        type: "fs.absolute",
        schemaVersion: "1.0.0",
        data: { path: join(root, "Game") }
      };
      const locationPlan = yield* adapterResolver.resolve([
        {
          feature: {
            id: "location.resolve",
            port: "location.behavior",
            operation: "resolve",
            portVersion: "0.2.0",
            requiredCapabilities: ["location.resolve"]
          },
          locations: [location]
        }
      ]);
      expect(locationPlan.unavailable).toEqual([]);
      expect(
        yield* adapterResolver.implementation(
          locationPlan.resolvedAdapters[0]!,
          locationImplementation
        ).resolve!({
          location
        })
      ).toEqual({
        status: "resolved",
        resource: {
          type: "filesystem.path",
          schemaVersion: "1.0.0",
          data: { path: join(root, "Game") }
        }
      });
      const standalone = yield* adapterResolver.resolve([
        {
          feature: gameModule.features[0]!,
          additionalCapabilities: ["discovery.source.standalone"]
        }
      ]);
      yield* adapterResolver
        .implementation(standalone.resolvedAdapters[0]!, gameDiscoveryImplementation)
        .discover({
          hostId: "synthetic",
          sourceId: "loose",
          sourceKind: "standalone",
          scope: { paths: [root], maxDepth: 0, exclude: [] }
        });
      const observedBeforeSteam = observed.length;
      const request = {
        feature: gameModule.features[0]!,
        additionalCapabilities: ["discovery.source.steam"]
      };
      expect((yield* adapterResolver.resolve([request])).unavailable).toHaveLength(1);
      yield* lifecycle.register([
        {
          kind: "extension",
          manifest: steamManifest,
          load: () =>
            Effect.tryPromise(() => import("../index.ts")).pipe(
              Effect.map(({ activate }) => defineExtensionModule({ activate }))
            )
        }
      ]);
      const steamPlan = yield* adapterResolver.resolve([request]);
      expect(steamPlan.unavailable).toEqual([]);
      const result = yield* adapterResolver
        .implementation(steamPlan.resolvedAdapters[0]!, gameDiscoveryImplementation)
        .discover({
          hostId: "synthetic",
          sourceId: "steam",
          sourceKind: "steam",
          scope: { paths: [root], maxDepth: 1, exclude: [] }
        });
      expect(result.diagnostics).toEqual([]);
      expect(observed.length).toBeGreaterThan(observedBeforeSteam);
      expect(observed.some((path) => path.endsWith("steamapps"))).toBe(true);
      expect(Context.get(services, EXTENSION_REGISTRY).get("konogame.steam")!.activation).toBe(
        "active"
      );
      expect(Context.getOption(services, FILESYSTEM_SAVE_STORE)._tag).toBe("None");
      expect(Context.getOption(services, GAME_DISCOVERY_FILESYSTEM)._tag).toBe("None");
    })
);
