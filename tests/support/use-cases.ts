import {
  FilesystemLocationBehavior,
  filesystemLocationAdapter,
  filesystemLocationTypes
} from "@konogame/extension-filesystem";
import { workspaceTomlExtensionSource } from "@konogame/extension-workspace-toml/providers";
import {
  type GameDiscoveryPort,
  gameDiscoveryImplementation,
  gameModuleSource
} from "@konogame/game";
import {
  GAME_ADMISSION,
  type GameDiscoveryService,
  provideGameAdmission
} from "@konogame/game/admission";
import {
  ADAPTER_RESOLUTION_PLANNER,
  type AdapterResolutionPlanner,
  type Contribution,
  defineExtensionModule,
  EXTENSION_CATALOG,
  EXTENSION_LIFECYCLE,
  type ExtensionActivationContext,
  type ExtensionCatalogService,
  type ExtensionDiscoverySource,
  type IdService,
  provideAdapterResolutionPlanner,
  provideExtensionCatalog,
  provideIdService,
  provideInfrastructure,
  provideTemporalService,
  type TemporalService
} from "@konogame/infrastructure";
import {
  type AdapterDescriptor,
  DECLARATION_PROTOCOL_RANGE,
  type LocationPort,
  type LocationTypeDefinition,
  locationImplementation,
  type ModuleDescriptor
} from "@konogame/infrastructure/contracts";
import { deterministicIdLayer, fixedTemporalLayer } from "@konogame/infrastructure/tests/support";
import { type SaveStorePort, saveModuleSource, saveStoreImplementation } from "@konogame/save";
import {
  provideSaveStoreWorkflow,
  SAVE_STORE_WORKFLOW,
  type SaveStoreWorkflow
} from "@konogame/save/store";
import {
  type ConfigurationHistoryPort,
  configurationHistoryImplementation,
  type WorkspaceConfigurationPort,
  type WorkspaceLocationBrowserPort,
  workspaceConfigurationImplementation,
  workspaceLocationBrowserImplementation,
  workspaceModuleSource
} from "@konogame/workspace";
import {
  provideWorkspaceBrowse,
  WORKSPACE_BROWSE,
  type WorkspaceBrowseService
} from "@konogame/workspace/browse";
import {
  provideWorkspaceManagement,
  WORKSPACE_MANAGEMENT,
  type WorkspaceManagementService
} from "@konogame/workspace/management";
import { Context, Effect, Layer } from "effect";

export interface UseCases {
  readonly plan: AdapterResolutionPlanner;
  readonly catalog: ExtensionCatalogService;
  readonly workspace: WorkspaceManagementService;
  readonly browse: WorkspaceBrowseService;
  readonly admission: GameDiscoveryService;
  readonly save: SaveStoreWorkflow;
}

export function provideOwnerLayers<R, E>(core: Layer.Layer<R, E>) {
  const plans = Layer.mergeAll(provideAdapterResolutionPlanner(), provideExtensionCatalog()).pipe(
    Layer.provideMerge(core)
  );
  return Layer.mergeAll(
    provideWorkspaceManagement(),
    provideWorkspaceBrowse(),
    provideGameAdmission(),
    provideSaveStoreWorkflow()
  ).pipe(Layer.provideMerge(plans));
}

export function useCases(
  context: Context.Context<
    | ADAPTER_RESOLUTION_PLANNER
    | EXTENSION_CATALOG
    | WORKSPACE_MANAGEMENT
    | WORKSPACE_BROWSE
    | GAME_ADMISSION
    | SAVE_STORE_WORKFLOW
  >
): UseCases {
  return {
    plan: Context.get(context, ADAPTER_RESOLUTION_PLANNER),
    catalog: Context.get(context, EXTENSION_CATALOG),
    workspace: Context.get(context, WORKSPACE_MANAGEMENT),
    browse: Context.get(context, WORKSPACE_BROWSE),
    admission: Context.get(context, GAME_ADMISSION),
    save: Context.get(context, SAVE_STORE_WORKFLOW)
  };
}
export function createApplication(
  modules: readonly ModuleDescriptor[],
  descriptors: readonly AdapterDescriptor[],
  stores: ReadonlyMap<string, SaveStorePort> = new Map(),
  configurations: ReadonlyMap<string, WorkspaceConfigurationPort> = new Map(),
  histories: ReadonlyMap<string, ConfigurationHistoryPort> = new Map(),
  discoveries: ReadonlyMap<string, GameDiscoveryPort> = new Map(),
  dependencies: { readonly ids?: IdService; readonly temporal?: TemporalService } = {},
  extras: {
    readonly browsers?: ReadonlyMap<string, WorkspaceLocationBrowserPort>;
    readonly locationBehaviors?: ReadonlyMap<string, LocationPort>;
    /** Location type definitions contributed by an Extension owner ID. */
    readonly locationTypes?: ReadonlyMap<string, readonly LocationTypeDefinition[]>;
  } = {}
) {
  const adapters = [
    ...descriptors.filter((item) => item.id !== filesystemLocationAdapter.id),
    filesystemLocationAdapter
  ];
  function register(context: ExtensionActivationContext, owned: readonly AdapterDescriptor[]) {
    return Effect.forEach(
      owned,
      (descriptor) => {
        if (descriptor.id === filesystemLocationAdapter.id) {
          return context.registerAdapter(
            descriptor.id,
            locationImplementation,
            new FilesystemLocationBehavior()
          );
        }
        const store = stores.get(descriptor.id);
        if (store) {
          return context.registerAdapter(descriptor.id, saveStoreImplementation, store);
        }
        const configuration = configurations.get(descriptor.id);
        if (configuration) {
          return context.registerAdapter(
            descriptor.id,
            workspaceConfigurationImplementation,
            configuration
          );
        }
        const history = histories.get(descriptor.id);
        if (history) {
          return context.registerAdapter(
            descriptor.id,
            configurationHistoryImplementation,
            history
          );
        }
        const browser = extras.browsers?.get(descriptor.id);
        if (browser) {
          return context.registerAdapter(
            descriptor.id,
            workspaceLocationBrowserImplementation,
            browser
          );
        }
        const behavior = extras.locationBehaviors?.get(descriptor.id);
        if (behavior) {
          return context.registerAdapter(descriptor.id, locationImplementation, behavior);
        }
        const discovery = discoveries.get(descriptor.id);
        if (discovery) {
          return context.registerAdapter(descriptor.id, gameDiscoveryImplementation, discovery);
        }
        return Effect.void;
      },
      { discard: true }
    );
  }
  const contributions: Contribution[] = [];
  for (const module of modules) {
    const owned = adapters.filter(
      (adapter) => adapter.owner.kind === "module" && adapter.owner.id === module.id
    );
    contributions.push({
      kind: "module",
      manifest: { ...module, contributes: { adapters: owned } },
      load: () =>
        Effect.succeed(defineExtensionModule({ activate: (context) => register(context, owned) }))
    });
  }
  const owners = new Set(
    adapters
      .filter((adapter) => adapter.owner.kind === "extension")
      .map((adapter) => adapter.owner.id)
  );
  for (const id of owners) {
    const owned = adapters.filter(
      (adapter) => adapter.owner.kind === "extension" && adapter.owner.id === id
    );
    contributions.push({
      kind: "extension",
      manifest: {
        id,
        version: "0.1.0-alpha.0",
        declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
        software: {},
        contributes: {
          adapters: owned,
          ...(id === filesystemLocationAdapter.owner.id
            ? { locations: filesystemLocationTypes }
            : extras.locationTypes?.has(id)
              ? { locations: [...extras.locationTypes.get(id)!] }
              : {})
        }
      },
      load: () =>
        Effect.succeed(defineExtensionModule({ activate: (context) => register(context, owned) }))
    });
  }
  const defaults = Layer.merge(
    dependencies.ids === undefined ? deterministicIdLayer() : provideIdService(dependencies.ids),
    dependencies.temporal === undefined
      ? fixedTemporalLayer()
      : provideTemporalService(dependencies.temporal)
  );
  const core = provideInfrastructure({}, [
    { id: "test.application", discover: () => Effect.succeed({ complete: true, contributions }) }
  ]).pipe(Layer.provide(defaults));
  return Layer.build(provideOwnerLayers(core)).pipe(Effect.map(useCases));
}
export function createApplicationContext(
  contributions: readonly Contribution[],
  overrides: Layer.Layer<never> = Layer.empty
) {
  const core = provideInfrastructure({}, [
    {
      id: "test.custom-application",
      discover: () => Effect.succeed({ complete: true, contributions })
    }
  ]).pipe(Layer.provide(overrides));
  return Layer.build(provideOwnerLayers(core));
}

export function composeInfrastructure<Error = never>(
  options: {
    readonly catalogOnly?: boolean;
    readonly discoverySources?: readonly ExtensionDiscoverySource[];
    readonly overrides?: Layer.Layer<never, Error>;
  } = {}
) {
  const overrides = options.overrides ?? Layer.empty;
  const infrastructure = provideInfrastructure({}, [
    saveModuleSource(),
    gameModuleSource(),
    workspaceModuleSource(),
    workspaceTomlExtensionSource(),
    ...(options.discoverySources ?? [])
  ]).pipe(Layer.provideMerge(overrides));
  return provideOwnerLayers(infrastructure).pipe(
    Layer.tap((services) => {
      const lifecycle = Context.get(services, EXTENSION_LIFECYCLE);
      return options.catalogOnly ? lifecycle.prepare() : lifecycle.initialize();
    })
  );
}
