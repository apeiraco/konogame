import { isDeepStrictEqual } from "node:util";
import {
  type AdapterOwner,
  AdapterOwnerKind,
  DECLARATION_PROTOCOL_VERSION,
  declarationIdSchema,
  type ExtensionManifest,
  type LocationContract,
  LocationTypeStatus,
  locationContractSchema,
  type ModuleDescriptor,
  type ModuleManifest,
  supportsDeclarationProtocolRange
} from "@konogame/infrastructure/contracts";
import { Context, Effect } from "effect";
import semver from "semver";
import { ActivationStatus } from "../extension/activation-contract.ts";
import {
  type Contribution,
  contributionId,
  contributionOwner,
  ReloadPolicy
} from "../extension/contribution.ts";
import {
  contributionIdentities,
  contributionItems,
  identifyContribution,
  parseContribution
} from "../extension/contribution-input.ts";
import {
  type InfrastructureError,
  infrastructureTry,
  LifecyclePhase
} from "../extension/diagnostics.ts";
import { immutableSnapshot as immutable, PublicationChannel } from "./publication-channel.ts";

export const RegistrationStatus = {
  Registered: "registered",
  Partial: "partially-registered",
  Replaced: "replaced",
  Removed: "removed",
  Rejected: "rejected",
  RestartRequired: "restart-service-required"
} as const;

export type RegistrationStatus = (typeof RegistrationStatus)[keyof typeof RegistrationStatus];

export interface RegistrationResult {
  catalogVersion: number;
  status: RegistrationStatus;
  ids: readonly string[];
  reason?: string;
}

export interface ContributionSnapshot {
  catalogVersion: number;
  id: string;
  owner: AdapterOwner;
  manifest: ExtensionManifest | ModuleManifest;
  generation: number;
  registration: typeof RegistrationStatus.Registered;
  activation: ActivationStatus;
  reason?: string;
  diagnostics?: readonly string[];
}

const registerPrepared = Symbol("register-prepared-contribution");
const replacePrepared = Symbol("replace-prepared-contribution");
const rejectPrepared = Symbol("reject-prepared-contribution");

/** Internal discovery path for declarations already parsed at their input boundary. */
export function registerPreparedContribution(
  registry: ExtensionRegistry,
  contribution: Contribution
): Effect.Effect<RegistrationResult, InfrastructureError> {
  return Effect.uninterruptible(
    infrastructureTry(LifecyclePhase.Registration, () => registry[registerPrepared]([contribution]))
  );
}

/** Internal discovery path for declarations already parsed at their input boundary. */
export function replacePreparedContribution(
  registry: ExtensionRegistry,
  contribution: Contribution
): Effect.Effect<RegistrationResult, InfrastructureError> {
  return Effect.uninterruptible(
    infrastructureTry(LifecyclePhase.Registration, () => registry[replacePrepared](contribution))
  );
}

/** Internal input path for failures already classified without re-entering declaration hooks. */
export function rejectPreparedContribution(
  registry: ExtensionRegistry,
  ids: readonly string[],
  cause: unknown
): Effect.Effect<RegistrationResult> {
  return Effect.uninterruptible(Effect.sync(() => registry[rejectPrepared](ids, cause)));
}

export class EXTENSION_REGISTRY extends Context.Service<EXTENSION_REGISTRY, ExtensionRegistry>()(
  "infrastructure.extension-registry"
) {}

interface Entry {
  contribution: Contribution;
  generation: number;
  activation: ActivationStatus;
  loadAttempted: boolean;
  reason?: string;
}
function dependencies(entry: Entry): readonly { extensionId: string; versionRange: string }[] {
  return entry.contribution.kind === AdapterOwnerKind.Extension
    ? (entry.contribution.manifest.dependencies ?? [])
    : [];
}
function active(status: ActivationStatus): boolean {
  return status === ActivationStatus.Active || status === ActivationStatus.Activating;
}
// Catalog consumers commit their private indexes before any public observer can run.
export const observeCatalogCommit = Symbol("observe-registry-commit");
export const enqueueCatalogPublication = Symbol("enqueue-registry-notification");
type CommitObserver = (catalogChanged: boolean) => () => void;

export class ExtensionRegistry {
  private entries = new Map<string, Entry>();
  private generation = 0;
  private catalogRevision = 0;
  private publicationRevision = 0;
  private currentSnapshot: readonly ContributionSnapshot[] = [];
  private readonly commitObservers = new Set<CommitObserver>();
  private readonly notifications: (() => void)[] = [];
  private notifying = false;
  private constructor(
    private readonly stateChannel: PublicationChannel<readonly ContributionSnapshot[]>,
    private readonly resultChannel: PublicationChannel<RegistrationResult>
  ) {}
  static make(): Effect.Effect<ExtensionRegistry> {
    return Effect.gen(function* () {
      const [stateChannel, resultChannel] = yield* Effect.all([
        PublicationChannel.make({ value: [] as readonly ContributionSnapshot[] }),
        PublicationChannel.make<RegistrationResult>()
      ]);
      return new ExtensionRegistry(stateChannel, resultChannel);
    });
  }
  get state$() {
    return this.stateChannel.stream;
  }
  get results$() {
    return this.resultChannel.stream;
  }
  register(contribution: unknown): Effect.Effect<RegistrationResult, InfrastructureError> {
    return Effect.uninterruptible(
      infrastructureTry(LifecyclePhase.Registration, () => this.registerNow(contribution))
    );
  }
  registerAll(contributions: unknown): Effect.Effect<RegistrationResult, InfrastructureError> {
    return Effect.uninterruptible(
      infrastructureTry(LifecyclePhase.Registration, () => this.registerAllNow(contributions))
    );
  }
  replace(contribution: unknown): Effect.Effect<RegistrationResult, InfrastructureError> {
    return Effect.uninterruptible(
      infrastructureTry(LifecyclePhase.Registration, () => this.replaceNow(contribution))
    );
  }
  remove(id: string): Effect.Effect<RegistrationResult, InfrastructureError> {
    return Effect.uninterruptible(
      infrastructureTry(LifecyclePhase.Registration, () => this.removeNow(id))
    );
  }
  markLoadAttempted(id: string, generation: number): Effect.Effect<void, InfrastructureError> {
    return infrastructureTry(LifecyclePhase.Load, () => this.markLoadAttemptedNow(id, generation));
  }
  markActivation(
    id: string,
    generation: number,
    status: ActivationStatus,
    reason?: string
  ): Effect.Effect<void> {
    return Effect.uninterruptible(
      Effect.sync(() => this.markActivationNow(id, generation, status, reason))
    );
  }
  get release(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.commitObservers.clear();
      yield* Effect.all([this.stateChannel.shutdown, this.resultChannel.shutdown], {
        discard: true
      });
    });
  }
  get snapshot(): readonly ContributionSnapshot[] {
    return this.currentSnapshot;
  }
  get catalogVersion(): number {
    return this.catalogRevision;
  }

  private registerNow(contribution: unknown): RegistrationResult {
    return this.registerAllNow([contribution]);
  }
  private registerAllNow(contributions: unknown): RegistrationResult {
    let prepared: readonly Contribution[];
    try {
      prepared = contributionItems(contributions).map(parseContribution);
    } catch (error) {
      this.result(
        RegistrationStatus.Rejected,
        contributionIdentities(contributions),
        String(error)
      );
      throw error;
    }
    return this[registerPrepared](prepared);
  }
  [registerPrepared](contributions: readonly Contribution[]): RegistrationResult {
    const proposed = new Map(this.entries);
    let generation = this.generation;
    const ids: string[] = [];
    try {
      for (const contribution of contributions) {
        const id = contributionId(contribution);
        ids.push(id);
        if (proposed.has(id)) {
          throw new Error(`Duplicate contribution: ${id}`);
        }
        proposed.set(id, {
          contribution,
          generation: ++generation,
          loadAttempted: false,
          activation: ActivationStatus.Inactive
        });
      }
      this.validate(proposed);
    } catch (error) {
      this.result(RegistrationStatus.Rejected, contributions.map(contributionId), String(error));
      throw error;
    }
    this.entries = proposed;
    this.generation = generation;
    return this.commit(RegistrationStatus.Registered, ids);
  }
  private replaceNow(value: unknown): RegistrationResult {
    let contribution: Contribution;
    try {
      contribution = parseContribution(value);
    } catch (error) {
      const id = identifyContribution(value).id;
      this.result(RegistrationStatus.Rejected, id ? [id] : [], String(error));
      throw error;
    }
    return this[replacePrepared](contribution);
  }
  [replacePrepared](contribution: Contribution): RegistrationResult {
    const id = contributionId(contribution);
    if (!this.entries.has(id)) {
      return this[registerPrepared]([contribution]);
    }
    const blocked = this.restartReason(id);
    if (blocked) {
      return this.result(RegistrationStatus.RestartRequired, [id], blocked);
    }
    const proposed = new Map(this.entries);
    try {
      proposed.set(id, {
        contribution,
        generation: this.generation + 1,
        loadAttempted: false,
        activation: ActivationStatus.Inactive
      });
      this.validate(proposed);
    } catch (error) {
      this.result(RegistrationStatus.Rejected, [id], String(error));
      throw error;
    }
    this.entries = proposed;
    this.generation++;
    return this.commit(RegistrationStatus.Replaced, [id]);
  }
  private removeNow(id: string): RegistrationResult {
    declarationIdSchema.assert(id);
    const blocked = this.restartReason(id);
    if (blocked) {
      return this.result(RegistrationStatus.RestartRequired, [id], blocked);
    }
    if (!this.entries.delete(id)) {
      return this.result(RegistrationStatus.Removed, [id]);
    }
    return this.commit(RegistrationStatus.Removed, [id]);
  }
  get(id: string): ContributionSnapshot | undefined {
    return this.snapshot.find((entry) => entry.id === id);
  }
  list(): readonly ContributionSnapshot[] {
    return this.snapshot;
  }
  modules(): readonly ModuleDescriptor[] {
    const modules = new Map<string, ModuleDescriptor>();
    for (const entry of this.entries.values()) {
      if (entry.contribution.kind !== AdapterOwnerKind.Module) {
        continue;
      }
      const manifest = entry.contribution.manifest;
      const previous = modules.get(manifest.id);
      const features = new Map(previous?.features.map((feature) => [feature.id, feature]));
      for (const feature of manifest.features) {
        features.set(feature.id, feature);
      }
      modules.set(manifest.id, {
        id: manifest.id,
        declarationProtocolRange: manifest.declarationProtocolRange,
        features: [...features.values()]
      });
    }
    return immutable(structuredClone([...modules.values()]));
  }
  getLocationType(type: string) {
    for (const entry of this.entries.values()) {
      const definition = entry.contribution.manifest.contributes?.locations?.find(
        (item) => item.type === type
      );
      if (definition) {
        return immutable({
          extensionId: entry.contribution.manifest.id,
          definition: structuredClone(definition)
        });
      }
    }
    return undefined;
  }
  checkLocation(location: LocationContract): { status: LocationTypeStatus; reason?: string } {
    locationContractSchema.assert(location);
    const registered = this.getLocationType(location.type);
    if (!registered) {
      return {
        status: LocationTypeStatus.Unverified,
        reason: `Unknown Location type or missing Extension: ${location.type}`
      };
    }
    if (!semver.satisfies(location.schemaVersion, registered.definition.schemaRange)) {
      return {
        status: LocationTypeStatus.Unverified,
        reason: `Unsupported Location schema: ${location.type}@${location.schemaVersion}`
      };
    }
    return { status: LocationTypeStatus.Supported };
  }
  source(id: string, generation: number): Contribution {
    const entry = this.entries.get(id);
    if (!entry || entry.generation !== generation) {
      throw new Error(`Stale contribution generation: ${id}@${generation}`);
    }
    return {
      ...entry.contribution,
      manifest: immutable(structuredClone(entry.contribution.manifest))
    } as Contribution;
  }
  private markLoadAttemptedNow(id: string, generation: number): void {
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.generation !== generation ||
      entry.activation !== ActivationStatus.Activating
    ) {
      throw new Error(`Stale contribution loader: ${id}@${generation}`);
    }
    entry.loadAttempted = true;
  }
  private markActivationNow(
    id: string,
    generation: number,
    status: ActivationStatus,
    reason?: string
  ): void {
    const entry = this.entries.get(id);
    if (!entry || entry.generation !== generation) {
      return;
    }
    entry.activation = status;
    entry.reason = reason;
    this.publish();
  }
  [rejectPrepared](ids: readonly string[], cause: unknown): RegistrationResult {
    return this.result(RegistrationStatus.Rejected, ids, String(cause));
  }
  private result(
    status: RegistrationStatus,
    ids: readonly string[],
    reason?: string
  ): RegistrationResult {
    const result = immutable({
      status,
      ids: [...ids],
      catalogVersion: this.catalogVersion,
      ...(reason ? { reason } : {})
    });
    this[enqueueCatalogPublication](() => this.resultChannel.publish(result));
    return result;
  }
  private commit(status: RegistrationStatus, ids: readonly string[]): RegistrationResult {
    this.catalogRevision++;
    const result = immutable({ status, ids: [...ids], catalogVersion: this.catalogVersion });
    this.publish(true, result);
    return result;
  }
  [observeCatalogCommit](observer: CommitObserver): () => void {
    this.commitObservers.add(observer);
    return () => this.commitObservers.delete(observer);
  }
  [enqueueCatalogPublication](notification: () => void): void {
    this.notifications.push(notification);
    if (this.notifying) {
      return;
    }
    this.notifying = true;
    try {
      while (this.notifications.length) {
        this.notifications.shift()!();
      }
    } finally {
      this.notifying = false;
    }
  }
  private publish(catalogChanged = false, result?: RegistrationResult): void {
    const revision = ++this.publicationRevision;
    const snapshot = immutable(
      [...this.entries].map(([id, entry]) => ({
        id,
        owner: contributionOwner(entry.contribution),
        manifest: structuredClone(entry.contribution.manifest),
        generation: entry.generation,
        catalogVersion: this.catalogVersion,
        registration: RegistrationStatus.Registered,
        activation: entry.activation,
        diagnostics: this.dependencyDiagnostics(id),
        ...(entry.reason ? { reason: entry.reason } : {})
      }))
    );
    this.currentSnapshot = snapshot;
    const notifyConsumers = [...this.commitObservers].map((observer) => observer(catalogChanged));
    this[enqueueCatalogPublication](() => {
      if (revision === this.publicationRevision) {
        this.stateChannel.publish(snapshot);
      }
      for (const notify of notifyConsumers) {
        notify();
      }
      if (result) {
        this.resultChannel.publish(result);
      }
    });
  }
  private validate(entries: ReadonlyMap<string, Entry>): void {
    const adapters = new Set<string>();
    const locations = new Set<string>();
    const modules = new Map<string, ModuleManifest>();
    const features = new Map<string, string>();
    const extensions = new Map<string, Entry>();
    for (const [id, entry] of entries) {
      const { manifest, kind } = entry.contribution;
      if (!supportsDeclarationProtocolRange(manifest.declarationProtocolRange)) {
        throw new Error(
          `Contribution ${id} does not support declaration protocol ${DECLARATION_PROTOCOL_VERSION}: ${manifest.declarationProtocolRange}`
        );
      }
      if (kind === AdapterOwnerKind.Extension) {
        if (extensions.has(manifest.id)) {
          throw new Error(`Duplicate Extension: ${manifest.id}`);
        }
        extensions.set(manifest.id, entry);
      } else {
        for (const feature of manifest.features) {
          const owner = features.get(feature.id);
          if (owner !== undefined && owner !== manifest.id) {
            throw new Error(`Conflicting Module Feature owner: ${feature.id}`);
          }
          features.set(feature.id, manifest.id);
        }
        const previous = modules.get(manifest.id);
        if (previous && previous.declarationProtocolRange !== manifest.declarationProtocolRange) {
          throw new Error(`Conflicting Module declaration protocol range: ${manifest.id}`);
        }
        if (previous) {
          for (const feature of manifest.features) {
            const old = previous.features.find((candidate) => candidate.id === feature.id);
            if (old && !isDeepStrictEqual(old, feature)) {
              throw new Error(`Conflicting Module Feature: ${feature.id}`);
            }
          }
        }
        modules.set(manifest.id, {
          ...manifest,
          features: [...(previous?.features ?? []), ...manifest.features]
        });
      }
      for (const adapter of manifest.contributes?.adapters ?? []) {
        if (adapter.owner.kind !== kind || adapter.owner.id !== manifest.id) {
          throw new Error(`Adapter ${adapter.id} has incompatible owner ${adapter.owner.id}`);
        }
        if (adapters.has(adapter.id)) {
          throw new Error(`Duplicate Adapter: ${adapter.id}`);
        }
        adapters.add(adapter.id);
      }
      for (const definition of manifest.contributes?.locations ?? []) {
        if (locations.has(definition.type)) {
          throw new Error(`Duplicate Location type: ${definition.type}`);
        }
        locations.add(definition.type);
      }
    }
  }
  dependencyDiagnostics(id: string): readonly string[] {
    const entry = this.entries.get(id);
    if (!entry) {
      return [`Unknown contribution: ${id}`];
    }
    const diagnostics = new Set<string>();
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (source: Entry): void => {
      const sourceId = contributionId(source.contribution);
      if (visiting.has(sourceId)) {
        diagnostics.add(`Cyclic Extension dependency: ${[...visiting, sourceId].join(" -> ")}`);
        return;
      }
      if (visited.has(sourceId)) {
        return;
      }
      visiting.add(sourceId);
      for (const dependency of dependencies(source)) {
        const target = [...this.entries.values()].find(
          (candidate) =>
            candidate.contribution.kind === AdapterOwnerKind.Extension &&
            candidate.contribution.manifest.id === dependency.extensionId
        );
        if (!target) {
          diagnostics.add(
            `Missing Extension dependency: ${sourceId} requires ${dependency.extensionId}`
          );
          continue;
        }
        if (
          target.contribution.kind === AdapterOwnerKind.Extension &&
          !semver.satisfies(target.contribution.manifest.version, dependency.versionRange)
        ) {
          diagnostics.add(
            `Incompatible Extension dependency: ${sourceId} requires ${dependency.extensionId} ${dependency.versionRange}, found ${target.contribution.manifest.version}`
          );
        }
        visit(target);
      }
      visiting.delete(sourceId);
      visited.add(sourceId);
    };
    visit(entry);
    return Object.freeze([...diagnostics]);
  }
  private restartReason(id: string): string | undefined {
    const entry = this.entries.get(id);
    if (!entry) {
      return undefined;
    }
    if (active(entry.activation)) {
      return `Contribution ${id} is ${entry.activation}; restart service required`;
    }
    if (entry.loadAttempted && entry.contribution.reloadPolicy === ReloadPolicy.RestartAfterLoad) {
      return `Contribution ${id} has attempted code loading; restart service required`;
    }
    if (entry.contribution.kind !== AdapterOwnerKind.Extension) {
      return undefined;
    }
    const targetId = entry.contribution.manifest.id;
    const dependsOn = (source: Entry, target: string, seen = new Set<string>()): boolean => {
      if (seen.has(contributionId(source.contribution))) {
        return false;
      }
      seen.add(contributionId(source.contribution));
      return dependencies(source).some(
        (dependency) =>
          dependency.extensionId === target ||
          [...this.entries.values()].some(
            (candidate) =>
              candidate.contribution.kind === AdapterOwnerKind.Extension &&
              candidate.contribution.manifest.id === dependency.extensionId &&
              dependsOn(candidate, target, seen)
          )
      );
    };
    for (const [dependentId, dependent] of this.entries) {
      if (active(dependent.activation) && dependsOn(dependent, targetId)) {
        return `Active dependent ${dependentId} requires ${id}; restart service required`;
      }
    }
    return undefined;
  }
}
