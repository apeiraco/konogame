import {
  type AdapterDescriptor,
  type Artifact,
  type ArtifactReference,
  type Binding,
  type BindingPlan,
  type BindingRequest,
  CONTRACT_VERSION,
  type ModuleDescriptor,
  supportsContractRange
} from "@konogame/contracts";
import { type SaveStorePort } from "@konogame/save";
import {
  type ConfigurationHistoryPort,
  HistoryAvailability,
  HistoryMode,
  type RenameConfigurationInput,
  type WorkspaceConfigurationPort,
  WorkspaceFeature
} from "@konogame/workspace";
import { inspectWorkspaceSnapshot, type WorkspaceSelection } from "./workspace.ts";

export { type WorkspaceSelection } from "./workspace.ts";

export class KonogameApplication {
  private readonly modules: readonly ModuleDescriptor[];
  private readonly adapters: readonly AdapterDescriptor[];
  private readonly saveStores: ReadonlyMap<string, SaveStorePort>;
  private readonly workspaceConfigurations: ReadonlyMap<string, WorkspaceConfigurationPort>;
  private readonly configurationHistories: ReadonlyMap<string, ConfigurationHistoryPort>;

  constructor(
    modules: readonly ModuleDescriptor[],
    adapters: readonly AdapterDescriptor[],
    saveStores: ReadonlyMap<string, SaveStorePort> = new Map(),
    workspaceConfigurations: ReadonlyMap<string, WorkspaceConfigurationPort> = new Map(),
    configurationHistories: ReadonlyMap<string, ConfigurationHistoryPort> = new Map()
  ) {
    for (const module of modules) {
      if (!supportsContractRange(module.contractRange))
        throw new Error(
          `Module ${module.id} does not support Contract ${CONTRACT_VERSION}: ${module.contractRange}`
        );
    }
    this.modules = modules;
    this.adapters = adapters;
    this.saveStores = saveStores;
    this.workspaceConfigurations = workspaceConfigurations;
    this.configurationHistories = configurationHistories;
  }

  features(): readonly string[] {
    return this.modules.flatMap((module) => module.features.map((feature) => feature.id));
  }

  plan(
    featureIds: readonly string[],
    preferences: Readonly<Record<string, string>> = {}
  ): BindingPlan {
    const requests: BindingRequest[] = featureIds.map((id) => {
      const feature = this.modules
        .flatMap((module) => module.features)
        .find((item) => item.id === id);
      if (!feature) throw new Error(`Unknown feature: ${id}`);
      return { feature, preferredAdapterId: preferences[id] };
    });
    return resolveBindings(requests, this.adapters);
  }

  async storeSave(artifact: Artifact, preferredAdapterId?: string): Promise<ArtifactReference> {
    const plan = this.plan(
      ["save.store"],
      preferredAdapterId === undefined ? {} : { "save.store": preferredAdapterId }
    );
    const binding = plan.bindings[0];
    if (!binding) throw new Error(plan.unavailable[0]?.reason ?? "No save store adapter available");
    const store = this.saveStores.get(binding.adapterId);
    if (!store) throw new Error(`Adapter ${binding.adapterId} has no active implementation`);
    return store.put(artifact);
  }

  async inspectWorkspace(root: string, selection: WorkspaceSelection = {}) {
    // Bootstrap selection cannot depend on the configuration it is about to load.
    const bindingPlan = this.plan(
      [WorkspaceFeature.Inspect],
      selection.preferredAdapterId === undefined
        ? {}
        : { [WorkspaceFeature.Inspect]: selection.preferredAdapterId }
    );
    const binding = bindingPlan.bindings[0];
    if (!binding)
      throw new Error(
        bindingPlan.unavailable[0]?.reason ?? "No Workspace configuration adapter available"
      );
    const configuration = this.workspaceConfigurations.get(binding.adapterId);
    if (!configuration)
      throw new Error(`Adapter ${binding.adapterId} has no active implementation`);
    const snapshot = await configuration.read({ root });
    const requestedAdapterId =
      snapshot.workspace.history.mode === HistoryMode.Disabled
        ? null
        : snapshot.workspace.history.adapterId;
    const historyPlan =
      requestedAdapterId === null
        ? this.plan([])
        : this.plan([WorkspaceFeature.History], { [WorkspaceFeature.History]: requestedAdapterId });
    const historyBinding = historyPlan.bindings[0];
    const activeHistory =
      historyBinding && this.configurationHistories.has(historyBinding.adapterId);
    return {
      ...inspectWorkspaceSnapshot(snapshot, selection),
      bindingPlan,
      history: {
        requestedAdapterId,
        status:
          requestedAdapterId === null
            ? HistoryAvailability.Disabled
            : activeHistory
              ? HistoryAvailability.Available
              : HistoryAvailability.Unavailable,
        bindingPlan: historyPlan,
        reason:
          historyBinding && !activeHistory
            ? `Adapter ${historyBinding.adapterId} has no active implementation`
            : historyPlan.unavailable[0]?.reason
      }
    };
  }

  async renameWorkspace(input: RenameConfigurationInput, preferredAdapterId?: string) {
    const bindingPlan = this.plan(
      [WorkspaceFeature.Rename],
      preferredAdapterId === undefined ? {} : { [WorkspaceFeature.Rename]: preferredAdapterId }
    );
    const binding = bindingPlan.bindings[0];
    if (!binding)
      throw new Error(
        bindingPlan.unavailable[0]?.reason ?? "No Workspace rename adapter available"
      );
    const configuration = this.workspaceConfigurations.get(binding.adapterId);
    if (!configuration?.rename)
      throw new Error(`Adapter ${binding.adapterId} has no active rename implementation`);
    const result = await configuration.rename(input);
    return { ...result, bindingPlan };
  }
}

export function resolveBindings(
  requests: readonly BindingRequest[],
  adapters: readonly AdapterDescriptor[]
): BindingPlan {
  const bindings: Binding[] = [];
  const unavailable: { feature: string; port: string; operation: string; reason: string }[] = [];
  for (const request of requests) {
    const { feature } = request;
    const required = [...feature.requiredCapabilities, ...(request.additionalCapabilities ?? [])];
    const candidates = adapters.filter(
      (adapter) =>
        adapter.port === feature.port &&
        supportsContractRange(adapter.contractRange) &&
        adapter.operations.includes(feature.operation) &&
        required.every((capability) => adapter.capabilities.includes(capability)) &&
        (request.preferredAdapterId === undefined || adapter.id === request.preferredAdapterId)
    );
    candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
    const selected = candidates[0];
    if (!selected) {
      unavailable.push({
        feature: feature.id,
        port: feature.port,
        operation: feature.operation,
        reason:
          request.preferredAdapterId !== undefined
            ? `No compatible adapter matches preference ${request.preferredAdapterId}`
            : `No adapter satisfies contract ${CONTRACT_VERSION}, operation ${feature.operation}, and capabilities ${required.join(", ") || "none"}`
      });
      continue;
    }
    bindings.push({
      feature: feature.id,
      port: feature.port,
      operation: feature.operation,
      adapterId: selected.id,
      extensionId: selected.extensionId,
      contractRange: selected.contractRange,
      capabilities: selected.capabilities
    });
  }
  return { contractVersion: CONTRACT_VERSION, bindings, unavailable };
}
