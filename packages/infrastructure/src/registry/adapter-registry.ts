import {
  type AdapterDescriptor,
  type AdapterResolutionPlan,
  type AdapterResolutionRequest,
  DECLARATION_PROTOCOL_VERSION,
  type ImplementationPort,
  implementationSchema,
  LocationTypeStatus,
  type ResolvedAdapter,
  selectAdapters
} from "@konogame/infrastructure/contracts";
import { Context, Effect } from "effect";
import { ActivationStatus } from "../extension/activation-contract.ts";
import {
  type InfrastructureError,
  infrastructureTry,
  LifecyclePhase
} from "../extension/diagnostics.ts";
import {
  type ContributionSnapshot,
  type ExtensionRegistry,
  enqueueCatalogPublication,
  observeCatalogCommit
} from "./extension-registry.ts";
import { immutableSnapshot as immutable, PublicationChannel } from "./publication-channel.ts";

export interface StagedAdapter {
  id: string;
  port: ImplementationPort<unknown>;
  implementation: unknown;
}

export const AdapterRegistrationStatus = {
  Declared: "declared",
  ImplementationPublished: "implementation-published",
  ImplementationCleared: "implementation-cleared",
  Removed: "removed",
  Disposed: "disposed"
} as const;

export type AdapterRegistrationStatus =
  (typeof AdapterRegistrationStatus)[keyof typeof AdapterRegistrationStatus];

export const ImplementationState = { Missing: "missing", Registered: "registered" } as const;

export type ImplementationState = (typeof ImplementationState)[keyof typeof ImplementationState];

export interface AdapterSnapshot {
  catalogVersion: number;
  descriptor: AdapterDescriptor;
  contributionId: string;
  generation: number;
  implementationState: ImplementationState;
  activation: ActivationStatus;
}

export interface AdapterRegistrationResult {
  catalogVersion: number;
  status: AdapterRegistrationStatus;
  adapterIds: readonly string[];
}

export class ADAPTER_REGISTRY extends Context.Service<ADAPTER_REGISTRY, AdapterRegistry>()(
  "infrastructure.adapter-registry"
) {}

interface AdapterEntry {
  descriptor: AdapterDescriptor;
  contributionId: string;
  generation: number;
  implementation?: unknown;
}
export class AdapterRegistry {
  private entries = new Map<string, AdapterEntry>();
  private readonly issued = new WeakMap<ResolvedAdapter, { id: string; generation: number }>();
  private readonly unsubscribeCommit: () => void;
  private publicationRevision = 0;
  private currentSnapshot: readonly AdapterSnapshot[] = [];
  get state$() {
    return this.stateChannel.stream;
  }
  get results$() {
    return this.resultChannel.stream;
  }
  static make(extensions: ExtensionRegistry): Effect.Effect<AdapterRegistry> {
    return Effect.gen(function* () {
      const [stateChannel, resultChannel] = yield* Effect.all([
        PublicationChannel.make({ value: [] as readonly AdapterSnapshot[] }),
        PublicationChannel.make<AdapterRegistrationResult>()
      ]);
      return new AdapterRegistry(extensions, stateChannel, resultChannel);
    });
  }
  get snapshot(): readonly AdapterSnapshot[] {
    return this.currentSnapshot;
  }
  get catalogVersion(): number {
    return this.extensions.catalogVersion;
  }
  private constructor(
    private readonly extensions: ExtensionRegistry,
    private readonly stateChannel: PublicationChannel<readonly AdapterSnapshot[]>,
    private readonly resultChannel: PublicationChannel<AdapterRegistrationResult>
  ) {
    this.sync();
    this.unsubscribeCommit = this.extensions[observeCatalogCommit]((catalogChanged) =>
      catalogChanged ? this.sync() : this.preparePublication()
    );
    this.stateChannel.publish(this.currentSnapshot);
  }
  descriptors(): readonly AdapterDescriptor[] {
    return structuredClone([...this.entries.values()].map((entry) => entry.descriptor));
  }
  contributionFor(adapterId: string): ContributionSnapshot | undefined {
    const entry = this.entries.get(adapterId);
    return entry && this.extensions.get(entry.contributionId);
  }
  stage<T>(
    id: string,
    generation: number,
    adapterId: string,
    port: ImplementationPort<T>,
    implementation: T
  ): StagedAdapter {
    const entry = this.entries.get(adapterId);
    if (!entry || entry.contributionId !== id || entry.generation !== generation) {
      throw new Error(`Adapter is not declared by contribution ${id}: ${adapterId}`);
    }
    if (port.id !== entry.descriptor.port || !port.is(implementation)) {
      throw new Error(`Invalid implementation for Adapter ${adapterId}`);
    }
    if (port.operations) {
      for (const operation of entry.descriptor.operations) {
        const method = port.operations[operation];
        if (method === undefined || !implementationSchema([String(method)])(implementation)) {
          throw new Error(
            `Adapter ${adapterId} has no implementation method for operation ${operation}`
          );
        }
      }
    }
    return { id: adapterId, port: port as ImplementationPort<unknown>, implementation };
  }
  commit(
    id: string,
    generation: number,
    staged: readonly StagedAdapter[]
  ): Effect.Effect<void, InfrastructureError> {
    return Effect.uninterruptible(
      infrastructureTry(LifecyclePhase.Activation, () => this.commitNow(id, generation, staged))
    );
  }
  private commitNow(id: string, generation: number, staged: readonly StagedAdapter[]): void {
    const current = this.extensions.get(id);
    if (
      !current ||
      current.generation !== generation ||
      current.activation !== ActivationStatus.Activating
    ) {
      throw new Error(`Stale activation: ${id}@${generation}`);
    }
    const unique = new Set<string>();
    for (const registration of staged) {
      if (unique.has(registration.id)) {
        throw new Error(`Duplicate Adapter implementation: ${registration.id}`);
      }
      unique.add(registration.id);
      this.stage(id, generation, registration.id, registration.port, registration.implementation);
    }
    for (const registration of staged) {
      this.entries.get(registration.id)!.implementation = registration.implementation;
    }
    this.publish();
    this.event(
      AdapterRegistrationStatus.ImplementationPublished,
      staged.map((item) => item.id)
    );
  }
  clear(id: string, generation: number): Effect.Effect<void> {
    return Effect.uninterruptible(Effect.sync(() => this.clearNow(id, generation)));
  }
  private clearNow(id: string, generation: number): void {
    const ids: string[] = [];
    for (const [adapterId, entry] of this.entries) {
      if (
        entry.contributionId === id &&
        entry.generation === generation &&
        entry.implementation !== undefined
      ) {
        delete entry.implementation;
        ids.push(adapterId);
      }
    }
    if (ids.length) {
      this.publish();
      this.event(AdapterRegistrationStatus.ImplementationCleared, ids);
    }
  }
  resolve(requests: readonly AdapterResolutionRequest[]): AdapterResolutionPlan {
    const resolvedAdapters: ResolvedAdapter[] = [];
    const unavailable: AdapterResolutionPlan["unavailable"][number][] = [];
    for (const request of requests) {
      const unsupported = request.locations
        ?.map((location) => this.extensions.checkLocation(location))
        .find((result) => result.status !== LocationTypeStatus.Supported);
      if (unsupported) {
        unavailable.push({
          feature: request.feature.id,
          port: request.feature.port,
          operation: request.feature.operation,
          reason: unsupported.reason!
        });
        continue;
      }
      const plan = selectAdapters(
        [request],
        [...this.entries.values()]
          .filter(
            (entry) =>
              entry.implementation !== undefined &&
              this.extensions.get(entry.contributionId)?.activation === ActivationStatus.Active
          )
          .map((entry) => entry.descriptor)
      );
      const resolvedAdapter = plan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        const declared = selectAdapters([request], this.descriptors()).resolvedAdapters[0];
        unavailable.push(
          declared
            ? {
                feature: request.feature.id,
                port: request.feature.port,
                operation: request.feature.operation,
                reason: `Adapter ${declared.adapterId} has no active implementation`
              }
            : plan.unavailable[0]!
        );
        continue;
      }
      const entry = this.entries.get(resolvedAdapter.adapterId)!;
      immutable(resolvedAdapter);
      this.issued.set(resolvedAdapter, { id: entry.contributionId, generation: entry.generation });
      resolvedAdapters.push(resolvedAdapter);
    }
    return {
      declarationProtocolVersion: DECLARATION_PROTOCOL_VERSION,
      resolvedAdapters,
      unavailable
    };
  }
  implementation<T>(resolvedAdapter: ResolvedAdapter, port: ImplementationPort<T>): T {
    const issued = this.issued.get(resolvedAdapter);
    const entry = this.entries.get(resolvedAdapter.adapterId);
    if (
      !issued ||
      !entry ||
      issued.id !== entry.contributionId ||
      issued.generation !== entry.generation
    ) {
      throw new Error("Resolved Adapter was not issued by the current AdapterRegistry generation");
    }
    if (
      this.extensions.get(entry.contributionId)?.activation !== ActivationStatus.Active ||
      resolvedAdapter.port !== port.id ||
      !port.is(entry.implementation)
    ) {
      throw new Error(
        `Adapter ${resolvedAdapter.adapterId} has no active implementation for Port ${port.id}`
      );
    }
    return entry.implementation;
  }
  get release(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.unsubscribeCommit();
      this.entries.clear();
      this.publish();
      this.event(AdapterRegistrationStatus.Disposed, []);
      yield* Effect.all([this.stateChannel.shutdown, this.resultChannel.shutdown], {
        discard: true
      });
    });
  }
  private sync(): () => void {
    const next = new Map<string, AdapterEntry>();
    for (const contribution of this.extensions.list()) {
      for (const descriptor of contribution.manifest.contributes?.adapters ?? []) {
        const previous = this.entries.get(descriptor.id);
        next.set(descriptor.id, {
          descriptor: structuredClone(descriptor),
          contributionId: contribution.id,
          generation: contribution.generation,
          ...(previous?.contributionId === contribution.id &&
          previous.generation === contribution.generation
            ? { implementation: previous.implementation }
            : {})
        });
      }
    }
    const removed = [...this.entries.keys()].filter((id) => !next.has(id));
    const declared = [...next]
      .filter(([id, entry]) => this.entries.get(id)?.generation !== entry.generation)
      .map(([id]) => id);
    this.entries = next;
    const notify = this.preparePublication();
    const catalogVersion = this.catalogVersion;
    return () => {
      notify();
      if (removed.length) {
        this.emitEvent(AdapterRegistrationStatus.Removed, removed, catalogVersion);
      }
      if (declared.length) {
        this.emitEvent(AdapterRegistrationStatus.Declared, declared, catalogVersion);
      }
    };
  }
  private publish(): void {
    const notify = this.preparePublication();
    this.extensions[enqueueCatalogPublication](notify);
  }
  private preparePublication(): () => void {
    const revision = ++this.publicationRevision;
    const snapshot = immutable(
      [...this.entries.values()].map((entry) => ({
        descriptor: structuredClone(entry.descriptor),
        contributionId: entry.contributionId,
        generation: entry.generation,
        catalogVersion: this.catalogVersion,
        implementationState:
          entry.implementation === undefined
            ? ImplementationState.Missing
            : ImplementationState.Registered,
        activation:
          this.extensions.get(entry.contributionId)?.activation ?? ActivationStatus.Inactive
      }))
    );
    this.currentSnapshot = snapshot;
    return () => {
      if (revision === this.publicationRevision) {
        this.stateChannel.publish(snapshot);
      }
    };
  }
  private event(status: AdapterRegistrationStatus, adapterIds: readonly string[]): void {
    const catalogVersion = this.catalogVersion;
    this.extensions[enqueueCatalogPublication](() =>
      this.emitEvent(status, adapterIds, catalogVersion)
    );
  }
  private emitEvent(
    status: AdapterRegistrationStatus,
    adapterIds: readonly string[],
    catalogVersion: number
  ): void {
    this.resultChannel.publish(immutable({ status, adapterIds: [...adapterIds], catalogVersion }));
  }
}
