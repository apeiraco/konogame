import { resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { gameDiscoveryImplementation, gameModule, gameModuleSource } from "@konogame/game";
import {
  ADAPTER_RESOLVER,
  EXTENSION_LIFECYCLE,
  provideInfrastructure
} from "@konogame/infrastructure";
import {
  type SaveStorePort,
  saveModule,
  saveModuleSource,
  saveStoreImplementation
} from "@konogame/save";
import { workspaceLocationBrowserImplementation, workspaceModuleSource } from "@konogame/workspace";
import {
  WorkspaceBrowseError,
  WorkspaceBrowseFailureKind,
  WorkspaceFeature,
  workspaceModule
} from "@konogame/workspace/contracts";
import { Context, Effect, Exit, Layer } from "effect";
import { vi } from "vitest";
import { type DiscoveryFileSystem } from "../game-discovery/filesystem.ts";
import { filesystemManifest } from "../manifest.ts";
import {
  FILESYSTEM_SAVE_STORE,
  filesystemExtensionSource,
  GAME_DISCOVERY_FILESYSTEM,
  WORKSPACE_BROWSE_ACCESS_POLICY,
  WORKSPACE_BROWSE_FILESYSTEM
} from "../providers.ts";
import { type WorkspaceBrowseFileSystem } from "../workspace-browse/io.ts";
import { type WorkspaceBrowseAccessPolicy } from "../workspace-browse/policy.ts";

const constructed = vi.hoisted(() => ({ loads: 0, fileSystems: 0, stores: 0 }));
vi.mock("../index.ts", async (original) => {
  constructed.loads++;
  return original();
});
vi.mock("../game-discovery/io.ts", async (original) => {
  const module = await original<typeof import("../game-discovery/io.ts")>();
  return {
    ...module,
    NodeDiscoveryFileSystem: class extends module.NodeDiscoveryFileSystem {
      constructor() {
        super();
        constructed.fileSystems++;
      }
    }
  };
});
vi.mock("../save-store/store.ts", async (original) => {
  const module = await original<typeof import("../save-store/store.ts")>();
  return {
    ...module,
    FilesystemSaveStore: class extends module.FilesystemSaveStore {
      constructor(...args: ConstructorParameters<typeof module.FilesystemSaveStore>) {
        super(...args);
        constructed.stores++;
      }
    }
  };
});

it.effect(
  "keeps declarations and initialization lazy, constructs on demand, and honors root owner Tag overrides",
  () =>
    Effect.gen(function* () {
      const options = { saveRoot: resolve("synthetic-unwritten-save-root") };
      expect(filesystemManifest.contributes.adapters).toHaveLength(4);
      const services = yield* Layer.build(
        provideInfrastructure({}, [
          saveModuleSource(),
          gameModuleSource(),
          filesystemExtensionSource(options)
        ])
      );
      const adapterResolver = Context.get(services, ADAPTER_RESOLVER),
        lifecycle = Context.get(services, EXTENSION_LIFECYCLE);
      yield* lifecycle.ready;
      expect(constructed).toEqual({ loads: 0, fileSystems: 0, stores: 0 });
      expect(Context.getOption(services, FILESYSTEM_SAVE_STORE)._tag).toBe("None");
      const feature = saveModule.features.find(({ id }) => id === "save.store")!;
      const plan = yield* adapterResolver.resolve([{ feature }]);
      expect(plan.unavailable).toEqual([]);
      expect(
        saveStoreImplementation.is(
          adapterResolver.implementation(plan.resolvedAdapters[0]!, saveStoreImplementation)
        )
      ).toBe(true);
      expect(Context.getOption(services, FILESYSTEM_SAVE_STORE)._tag).toBe("None");
      expect(constructed).toEqual({ loads: 1, fileSystems: 1, stores: 1 });
      const isolated = yield* Layer.build(
        provideInfrastructure({}, [filesystemExtensionSource(options)])
      );
      expect(Context.getOption(isolated, FILESYSTEM_SAVE_STORE)._tag).toBe("None");
      const observations: string[] = [];
      const fileSystem: DiscoveryFileSystem = {
        inspect: (path) =>
          Effect.sync(() => {
            observations.push(path);
            return { kind: "directory", size: 0, identity: path };
          }),
        list: () => Effect.succeed([]),
        readText: () => Effect.die(new Error("Unexpected read"))
      };
      const store: SaveStorePort = {
        put: () => Effect.die(new Error("Unexpected store")),
        open: () => Effect.die(new Error("Unexpected open"))
      };
      const overrides = Layer.merge(
        Layer.succeed(GAME_DISCOVERY_FILESYSTEM, fileSystem),
        Layer.succeed(FILESYSTEM_SAVE_STORE, store)
      );
      const overridden = yield* Layer.build(
        provideInfrastructure({}, [
          saveModuleSource(),
          gameModuleSource(),
          filesystemExtensionSource(options)
        ]).pipe(Layer.provideMerge(overrides))
      );
      const selected = Context.get(overridden, ADAPTER_RESOLVER);
      const selectedPlan = yield* selected.resolve([
        {
          feature: gameModule.features[0]!,
          additionalCapabilities: ["discovery.source.standalone"]
        }
      ]);
      expect(selectedPlan.unavailable).toEqual([]);
      yield* selected
        .implementation(selectedPlan.resolvedAdapters[0]!, gameDiscoveryImplementation)
        .discover({
          hostId: "synthetic",
          sourceId: "loose",
          sourceKind: "standalone",
          scope: { paths: [resolve("synthetic-unwritten-game")], maxDepth: 0, exclude: [] }
        });
      expect(observations.length).toBeGreaterThan(0);
      expect(Context.get(overridden, FILESYSTEM_SAVE_STORE)).toBe(store);
      expect(constructed).toEqual({ loads: 1, fileSystems: 1, stores: 1 });
    })
);

it.effect(
  "uses the root browse access policy before the lazily activated browser performs I/O",
  () =>
    Effect.gen(function* () {
      let checks = 0;
      const denied = new WorkspaceBrowseError({
        issue: { kind: WorkspaceBrowseFailureKind.Denied },
        message: "Synthetic browsing policy denied access"
      });
      const policy: WorkspaceBrowseAccessPolicy = {
        check: () =>
          Effect.sync(() => {
            checks++;
          }).pipe(Effect.andThen(Effect.fail(denied)))
      };
      const fileSystem: WorkspaceBrowseFileSystem = {
        startingPoints: () => Effect.die("Denied browser reached filesystem"),
        listDirectories: () => Effect.die("Denied browser reached filesystem")
      };
      const overrides = Layer.merge(
        Layer.succeed(WORKSPACE_BROWSE_ACCESS_POLICY, policy),
        Layer.succeed(WORKSPACE_BROWSE_FILESYSTEM, fileSystem)
      );
      const services = yield* Layer.build(
        provideInfrastructure({}, [
          workspaceModuleSource(),
          filesystemExtensionSource({ saveRoot: resolve("synthetic-unwritten-save-root") })
        ]).pipe(Layer.provideMerge(overrides))
      );
      const resolver = Context.get(services, ADAPTER_RESOLVER);
      const feature = workspaceModule.features.find(({ id }) => id === WorkspaceFeature.Browse)!;
      const plan = yield* resolver.resolve([{ feature }]);
      expect(plan.unavailable).toEqual([]);
      const browser = resolver.implementation(
        plan.resolvedAdapters[0]!,
        workspaceLocationBrowserImplementation
      );
      const result = yield* Effect.exit(browser.list({ limit: 1 }));
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(result.cause.reasons).toContainEqual(
          expect.objectContaining({ _tag: "Fail", error: denied })
        );
      }
      expect(checks).toBe(1);
      expect(Context.get(services, WORKSPACE_BROWSE_ACCESS_POLICY)).toBe(policy);
      expect(Context.get(services, WORKSPACE_BROWSE_FILESYSTEM)).toBe(fileSystem);
    })
);
