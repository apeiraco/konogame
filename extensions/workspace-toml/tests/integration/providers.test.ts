import { expect, it } from "@effect/vitest";
import {
  ADAPTER_RESOLVER,
  EXTENSION_LIFECYCLE,
  provideInfrastructure,
  UuidIdService
} from "@konogame/infrastructure";
import {
  WORKSPACE_CONFIGURATION,
  WorkspaceFeature,
  workspaceConfigurationImplementation,
  workspaceModule,
  workspaceModuleSource
} from "@konogame/workspace";
import { Context, Effect, Layer, Option } from "effect";
import {
  createWorkspaceTomlExtensionModule,
  NodeWorkspaceFileSystem,
  NodeWorkspaceImportFileSystem,
  WORKSPACE_IMPORT_FILESYSTEM,
  workspaceTomlConfigurationAdapter,
  workspaceTomlExtensionSource,
  workspaceTomlManifest
} from "../../src/index.ts";
import { fixture } from "../support/workspace-fixture.ts";

it.effect(
  "contributes Extension-owned configuration lazily and reads its owner I/O Layer override",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      class TrackingFileSystem extends NodeWorkspaceImportFileSystem {
        reads = 0;
        override readWorkspace(root: string) {
          return super.readWorkspace(root).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                this.reads++;
              })
            )
          );
        }
      }
      const fileSystem = new TrackingFileSystem(new NodeWorkspaceFileSystem(), new UuidIdService());
      const services = yield* Layer.build(
        provideInfrastructure({}, [workspaceModuleSource(), workspaceTomlExtensionSource()]).pipe(
          Layer.provideMerge(Layer.succeed(WORKSPACE_IMPORT_FILESYSTEM, fileSystem))
        )
      );
      const lifecycle = Context.get(services, EXTENSION_LIFECYCLE);
      yield* lifecycle.initialize();
      expect(fileSystem.reads).toBe(0);
      expect(Option.isNone(Context.getOption(services, WORKSPACE_CONFIGURATION))).toBe(true);
      const adapterResolver = Context.get(services, ADAPTER_RESOLVER);
      const plan = yield* adapterResolver.resolve([
        {
          feature: workspaceModule.features.find(({ id }) => id === "workspace.inspect")!
        }
      ]);
      expect(plan.unavailable).toEqual([]);
      expect(plan.resolvedAdapters[0]?.owner).toEqual(workspaceTomlConfigurationAdapter.owner);
      expect(plan.resolvedAdapters[0]?.owner).toEqual({
        kind: "extension",
        id: workspaceTomlManifest.id
      });
      const configuration = adapterResolver.implementation(
        plan.resolvedAdapters[0]!,
        workspaceConfigurationImplementation
      )!;
      expect(workspaceConfigurationImplementation.is(configuration)).toBe(true);
      expect(Option.isNone(Context.getOption(services, WORKSPACE_CONFIGURATION))).toBe(true);
      expect(Context.get(services, WORKSPACE_IMPORT_FILESYSTEM)).toBe(fileSystem);
      const snapshot = yield* configuration.read({ root: f.root });
      expect(snapshot.workspace.id).toBe(f.workspace.id);
      const result = yield* configuration.import!({
        root: f.root,
        operationId: f.game.id,
        expectedRevision: snapshot.revision,
        games: [],
        installations: []
      });
      expect(result.status).toBe("unchanged");
      expect(fileSystem.reads).toBeGreaterThan(0);
    })
);

it.effect(
  "late-registers TOML configuration without adding implementation services to the root Layer",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      const services = yield* Layer.build(provideInfrastructure({}, [workspaceModuleSource()]));
      const lifecycle = Context.get(services, EXTENSION_LIFECYCLE);
      yield* lifecycle.initialize();
      yield* lifecycle.register([
        {
          kind: "extension",
          manifest: workspaceTomlManifest,
          load: () => Effect.succeed(createWorkspaceTomlExtensionModule())
        }
      ]);
      const adapterResolver = Context.get(services, ADAPTER_RESOLVER);
      const plan = yield* adapterResolver.resolve([
        {
          feature: workspaceModule.features.find(({ id }) => id === "workspace.inspect")!
        }
      ]);
      expect(plan.unavailable).toEqual([]);
      const configuration = adapterResolver.implementation(
        plan.resolvedAdapters[0]!,
        workspaceConfigurationImplementation
      )!;
      expect((yield* configuration.read({ root: f.root })).workspace.id).toBe(f.workspace.id);
      expect(Option.isNone(Context.getOption(services, WORKSPACE_CONFIGURATION))).toBe(true);
      expect(Option.isNone(Context.getOption(services, WORKSPACE_IMPORT_FILESYSTEM))).toBe(true);
    })
);

it.effect("Workspace Features remain registered without a TOML Extension", () =>
  Effect.gen(function* () {
    const services = yield* Layer.build(provideInfrastructure({}, [workspaceModuleSource()]));
    yield* Context.get(services, EXTENSION_LIFECYCLE).initialize();
    const resolver = Context.get(services, ADAPTER_RESOLVER);
    expect(resolver.modules().map(({ id }) => id)).toEqual([workspaceModule.id]);
    expect(resolver.features().map(({ id }) => id)).toContain(WorkspaceFeature.Inspect);
    const plan = yield* resolver.resolve([
      { feature: workspaceModule.features.find(({ id }) => id === WorkspaceFeature.Inspect)! }
    ]);
    expect(plan.resolvedAdapters).toEqual([]);
    expect(plan.unavailable).toHaveLength(1);
  })
);
