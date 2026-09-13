import { isDeepStrictEqual } from "node:util";
import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Cause, Clock, Deferred, Effect, Exit, type Scope, Semaphore } from "effect";
import {
  type ExtensionRegistry,
  RegistrationStatus,
  registerPreparedContribution,
  replacePreparedContribution
} from "../registry/extension-registry.ts";
import { type ExtensionActivationService } from "./activation.ts";
import { requireExtensionEffect } from "./callback-result.ts";
import { type Contribution, contributionId } from "./contribution.ts";
import { ContributionInputStatus, decodeContribution } from "./contribution-input.ts";
import {
  InfrastructureError,
  infrastructureTry,
  type LifecycleDiagnostic,
  LifecyclePhase
} from "./diagnostics.ts";
import {
  type ExtensionDiscoverySource,
  type RefreshResult,
  type SourceSnapshot
} from "./discovery.ts";
import { type DecodedDiscoveryBatch, decodeDiscoveryBatch } from "./discovery-input.ts";
import { type LifetimePolicy } from "./lifetime.ts";

export class ExtensionDiscovery {
  private readonly installed = new Map<string, Map<string, Contribution>>();
  private readonly ownership = new Map<string, string>();
  private readonly generations = new Map<string, number>();
  private readonly refreshing = new Map<
    string,
    Deferred.Deferred<RefreshResult, InfrastructureError>
  >();
  private readonly refreshLock = Semaphore.makeUnsafe(1);
  constructor(
    private readonly extensions: ExtensionRegistry,
    private readonly activation: ExtensionActivationService,
    private readonly sources: readonly ExtensionDiscoverySource[],
    private readonly policy: LifetimePolicy,
    private readonly scope: Scope.Closeable,
    private readonly diagnose: (diagnostic: LifecycleDiagnostic) => void,
    private readonly diagnostics: () => readonly LifecycleDiagnostic[]
  ) {}
  get catalog(): readonly SourceSnapshot[] {
    return Object.freeze(
      this.sources.map((source) =>
        Object.freeze({
          id: source.id,
          contributionIds: Object.freeze([...(this.installed.get(source.id)?.keys() ?? [])])
        })
      )
    );
  }
  sourceFor(id: string): string | undefined {
    return this.ownership.get(id);
  }
  prepare(): Effect.Effect<RefreshResult, InfrastructureError> {
    return this.discoverAndApply(this.sources);
  }
  refresh(
    prepared: Effect.Effect<void, InfrastructureError>,
    sourceId?: string
  ): Effect.Effect<RefreshResult, InfrastructureError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        const key = sourceId ?? "*";
        const existing = this.refreshing.get(key);
        if (existing) {
          return yield* restore(Deferred.await(existing));
        }
        const completion = Deferred.makeUnsafe<RefreshResult, InfrastructureError>();
        this.refreshing.set(key, completion);
        const work = Effect.gen({ self: this }, function* () {
          yield* prepared;
          const sources = sourceId
            ? this.sources.filter((source) => source.id === sourceId)
            : this.sources;
          if (!sources.length) {
            return yield* Effect.fail(
              new InfrastructureError({
                phase: LifecyclePhase.Discovery,
                message: `Unknown discovery source: ${sourceId}`
              })
            );
          }
          const result = yield* this.discoverAndApply(sources);
          yield* this.activation.catalogChanged();
          yield* this.activation.whenIdle();
          return result;
        }).pipe(
          Semaphore.withPermits(this.refreshLock, 1),
          Effect.onExit((exit) =>
            Effect.gen({ self: this }, function* () {
              this.refreshing.delete(key);
              yield* Deferred.done(completion, exit);
            })
          )
        );
        const fiber = yield* Effect.forkIn(work, this.scope, { uninterruptible: false });
        fiber.addObserver((exit) => {
          this.refreshing.delete(key);
          Deferred.doneUnsafe(completion, exit);
        });
        return yield* restore(Deferred.await(completion));
      })
    );
  }
  private discover(
    source: ExtensionDiscoverySource
  ): Effect.Effect<DecodedDiscoveryBatch | undefined> {
    return Effect.gen({ self: this }, function* () {
      const started = yield* Clock.currentTimeMillis;
      return yield* this.policy
        .bound(
          Effect.suspend(() => {
            return requireExtensionEffect(
              source.discover(),
              "Discovery source must return an Effect"
            );
          }),
          LifecyclePhase.Discovery,
          this.policy.budgets.discoveryMs
        )
        .pipe(
          Effect.flatMap((batch) =>
            infrastructureTry(LifecyclePhase.Discovery, () => decodeDiscoveryBatch(batch))
          ),
          Effect.catchCause((cause) =>
            Effect.gen({ self: this }, function* () {
              if (Cause.hasInterrupts(cause)) {
                return yield* Effect.interrupt;
              }
              this.diagnose({
                sourceId: source.id,
                phase: LifecyclePhase.Discovery,
                reason: Cause.pretty(cause),
                durationMs: (yield* Clock.currentTimeMillis) - started
              });
              return undefined;
            })
          )
        );
    });
  }
  discoverAndApply(
    sources: readonly ExtensionDiscoverySource[]
  ): Effect.Effect<RefreshResult, InfrastructureError> {
    return Effect.gen({ self: this }, function* () {
      const diagnosticsStart = this.diagnostics().length;
      const batches = yield* Effect.forEach(sources, (source) => this.discover(source), {
        concurrency: "unbounded"
      });
      const inputs = batches.map((batch) => batch?.contributions.map(decodeContribution) ?? []);
      const candidateSources = new Map<string, Set<string>>();
      for (const [index, source] of sources.entries()) {
        for (const input of inputs[index] ?? []) {
          if (input.status === ContributionInputStatus.Accepted) {
            const id = contributionId(input.contribution);
            const owners = candidateSources.get(id) ?? new Set<string>();
            owners.add(source.id);
            candidateSources.set(id, owners);
          }
        }
      }
      const added: string[] = [],
        unchanged: string[] = [],
        replaced: string[] = [],
        removed: string[] = [],
        restartRequired: string[] = [];
      for (const [index, source] of sources.entries()) {
        const batch = batches[index];
        if (!batch) {
          continue;
        }
        const previous = this.installed.get(source.id) ?? new Map<string, Contribution>();
        this.installed.set(source.id, previous);
        const seen = new Set<string>();
        let incomplete = !batch.complete;
        if (!batch.complete && !batch.diagnostics?.length) {
          this.diagnose({
            sourceId: source.id,
            phase: LifecyclePhase.Discovery,
            reason: "Discovery batch is incomplete; previous records are retained"
          });
        }
        for (const diagnostic of batch.diagnostics ?? []) {
          this.diagnose({ ...diagnostic, sourceId: source.id });
          incomplete = true;
        }
        restartRequired.push(...(batch.restartRequired ?? []));
        if (batch.restartRequired?.length) {
          incomplete = true;
        }
        const candidates: Contribution[] = [];
        for (const input of inputs[index] ?? []) {
          if (input.status === ContributionInputStatus.Accepted) {
            candidates.push(input.contribution);
          } else {
            incomplete = true;
            this.diagnose({
              sourceId: source.id,
              contributionId: input.identity.id,
              phase: LifecyclePhase.Registration,
              reason: String(input.cause)
            });
            if (input.fatal) {
              return yield* Effect.fail(
                new InfrastructureError({
                  phase: LifecyclePhase.Registration,
                  message: String(input.cause),
                  cause: input.cause
                })
              );
            }
          }
        }
        candidates.sort(
          (left, right) =>
            Number(left.kind === AdapterOwnerKind.Extension) -
            Number(right.kind === AdapterOwnerKind.Extension)
        );
        const counts = new Map<string, number>();
        for (const candidate of candidates) {
          const id = contributionId(candidate);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const candidate of candidates) {
          const id = contributionId(candidate);
          if (
            seen.has(id) ||
            (counts.get(id) ?? 0) > 1 ||
            (candidateSources.get(id)?.size ?? 0) > 1 ||
            (this.ownership.has(id) && this.ownership.get(id) !== source.id) ||
            (!previous.has(id) && this.extensions.get(id))
          ) {
            incomplete = true;
            this.diagnose({
              sourceId: source.id,
              contributionId: id,
              phase: LifecyclePhase.Registration,
              reason: `Conflicting contribution source: ${id}`
            });
            continue;
          }
          seen.add(id);
          if (batch.restartRequired?.includes(id)) {
            continue;
          }
          const old = previous.get(id);
          if (
            old &&
            this.generations.get(id) === this.extensions.get(id)?.generation &&
            isDeepStrictEqual(old.manifest, candidate.manifest) &&
            old.revision === candidate.revision &&
            old.reloadPolicy === candidate.reloadPolicy &&
            (candidate.revision !== undefined || old.load === candidate.load)
          ) {
            unchanged.push(id);
            continue;
          }
          const exit = yield* Effect.exit(
            old
              ? replacePreparedContribution(this.extensions, candidate)
              : registerPreparedContribution(this.extensions, candidate)
          );
          if (Exit.isFailure(exit)) {
            incomplete = true;
            this.diagnose({
              sourceId: source.id,
              contributionId: id,
              phase: LifecyclePhase.Registration,
              reason: Cause.pretty(exit.cause)
            });
            if (candidate.kind === AdapterOwnerKind.Module) {
              return yield* Effect.failCause(exit.cause);
            }
            continue;
          }
          if (exit.value.status === RegistrationStatus.RestartRequired) {
            restartRequired.push(id);
            continue;
          }
          previous.set(id, candidate);
          this.ownership.set(id, source.id);
          this.generations.set(id, this.extensions.get(id)!.generation);
          (old ? replaced : added).push(id);
        }
        if (!incomplete) {
          for (const id of [...previous.keys()]) {
            if (seen.has(id)) {
              continue;
            }
            const result = yield* this.extensions.remove(id);
            if (result.status === RegistrationStatus.RestartRequired) {
              restartRequired.push(id);
            } else {
              previous.delete(id);
              this.ownership.delete(id);
              this.generations.delete(id);
              removed.push(id);
            }
          }
        }
      }
      const diagnostics = Object.freeze(this.diagnostics().slice(diagnosticsStart));
      return Object.freeze({
        status: restartRequired.length
          ? RegistrationStatus.RestartRequired
          : diagnostics.length
            ? added.length + replaced.length + removed.length
              ? RegistrationStatus.Partial
              : RegistrationStatus.Rejected
            : RegistrationStatus.Registered,
        sourceIds: Object.freeze(sources.map((source) => source.id)),
        added: Object.freeze(added),
        unchanged: Object.freeze(unchanged),
        replaced: Object.freeze(replaced),
        removed: Object.freeze(removed),
        restartRequired: Object.freeze([...new Set(restartRequired)]),
        diagnostics,
        catalogVersion: this.extensions.catalogVersion
      });
    });
  }
}
