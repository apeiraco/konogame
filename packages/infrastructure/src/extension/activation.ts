import { isDeepStrictEqual } from "node:util";
import {
  AdapterOwnerKind,
  type AdapterResolutionRequest,
  type ImplementationPort,
  LocationTypeStatus,
  selectAdapters
} from "@konogame/infrastructure/contracts";
import { Cause, Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { type InfrastructureServices } from "../providers.ts";
import { type AdapterRegistry, type StagedAdapter } from "../registry/adapter-registry.ts";
import {
  type ContributionSnapshot,
  type ExtensionRegistry,
  RegistrationStatus
} from "../registry/extension-registry.ts";
import { PublicationChannel } from "../registry/publication-channel.ts";
import {
  ActivationEvent,
  type ActivationResult,
  ActivationStatus,
  type ExtensionActivationContext
} from "./activation-contract.ts";
import { requireExtensionEffect } from "./callback-result.ts";
import {
  InfrastructureError,
  infrastructureTry,
  type LifecycleDiagnostic,
  LifecyclePhase
} from "./diagnostics.ts";
import { activationEffect, assertExtensionModule, extensionLayer } from "./extension-module.ts";
import { type LifetimePolicy } from "./lifetime.ts";

export class EXTENSION_ACTIVATION extends Context.Service<
  EXTENSION_ACTIVATION,
  ExtensionActivationService
>()("infrastructure.extension-activation") {}

const ActivationPath = Context.Reference<readonly string[]>("infrastructure.activation-path", {
  defaultValue: () => []
});
interface Generation {
  readonly scope: Scope.Closeable;
  services?: Context.Context<unknown>;
  open: boolean;
}

export class ExtensionActivationService {
  private readonly completions = new Map<string, Deferred.Deferred<ActivationResult>>();
  private readonly waiting = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Fiber.Fiber<ActivationResult>>();
  private readonly generations = new Map<string, Generation>();
  private readonly activeOrder: string[] = [];
  private readonly events = new Map<string, boolean>();
  private readonly demands: AdapterResolutionRequest[] = [];
  private closing = false;
  private currentDiagnostics: readonly LifecycleDiagnostic[] = [];
  get diagnostics(): readonly LifecycleDiagnostic[] {
    return this.currentDiagnostics;
  }
  private constructor(
    private readonly extensions: ExtensionRegistry,
    private readonly adapters: AdapterRegistry,
    private readonly policy: LifetimePolicy,
    private readonly workScope: Scope.Closeable,
    private readonly rootServices: Effect.Effect<
      Context.Context<InfrastructureServices>,
      InfrastructureError
    >,
    private readonly diagnosticsChannel: PublicationChannel<LifecycleDiagnostic>,
    private readonly resultsChannel: PublicationChannel<ActivationResult>
  ) {}
  static make(
    extensions: ExtensionRegistry,
    adapters: AdapterRegistry,
    policy: LifetimePolicy,
    rootServices: Effect.Effect<Context.Context<InfrastructureServices>, InfrastructureError>
  ): Effect.Effect<ExtensionActivationService, never, Scope.Scope> {
    return Effect.gen(function* () {
      const workScope = yield* Scope.make();
      const service = new ExtensionActivationService(
        extensions,
        adapters,
        policy,
        workScope,
        rootServices,
        yield* PublicationChannel.make<LifecycleDiagnostic>(),
        yield* PublicationChannel.make<ActivationResult>()
      );
      yield* Effect.forkIn(
        Stream.runForEach(extensions.results$, (result) =>
          result.status === RegistrationStatus.Registered ||
          result.status === RegistrationStatus.Replaced ||
          result.status === RegistrationStatus.Removed
            ? service.replay
            : Effect.void
        ),
        workScope,
        { startImmediately: true }
      );
      return service;
    });
  }
  get state$() {
    return this.extensions.state$;
  }
  get diagnostics$() {
    return this.diagnosticsChannel.stream;
  }
  get results$() {
    return this.resultsChannel.stream;
  }
  get snapshot(): readonly ContributionSnapshot[] {
    return this.extensions.snapshot;
  }

  activate(id: string): Effect.Effect<ActivationResult> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        const entry = this.extensions.get(id);
        if (!entry) {
          return this.result({
            id,
            generation: 0,
            status: ActivationStatus.Failed,
            reason: `Unknown contribution: ${id}`
          });
        }
        if (this.closing) {
          return this.result({
            id,
            generation: entry.generation,
            status: ActivationStatus.Disposed,
            reason: "Process is closing"
          });
        }
        const key = `${id}@${entry.generation}`;
        const path = yield* ActivationPath;
        const caller = path.at(-1);
        if (caller && this.reaches(key, caller)) {
          return this.result({
            id,
            generation: entry.generation,
            status: ActivationStatus.Blocked,
            reason: `Cyclic activation request: ${caller} -> ${key}`
          });
        }
        let completion = this.completions.get(key);
        if (!completion) {
          completion = Deferred.makeUnsafe<ActivationResult>();
          this.completions.set(key, completion);
          const diagnostics = this.extensions.dependencyDiagnostics(id);
          if (diagnostics.length) {
            const reason = diagnostics.join("; ");
            yield* this.extensions.markActivation(
              id,
              entry.generation,
              ActivationStatus.Blocked,
              reason
            );
            const result = this.result({
              id,
              generation: entry.generation,
              status: ActivationStatus.Blocked,
              reason
            });
            this.completions.delete(key);
            yield* Deferred.succeed(completion, result);
            return result;
          }
          yield* this.extensions.markActivation(id, entry.generation, ActivationStatus.Activating);
          const target = completion;
          const task = this.run(entry).pipe(
            Effect.provideService(ActivationPath, [...path, key]),
            Effect.onExit((exit) => Deferred.done(target, exit)),
            Effect.ensuring(Effect.sync(() => this.pending.delete(key)))
          );
          const fiber = yield* Effect.forkIn(task, this.workScope, { uninterruptible: false });
          fiber.addObserver((exit) => {
            Deferred.doneUnsafe(target, exit);
            this.pending.delete(key);
          });
          this.pending.set(key, fiber);
          if (fiber.pollUnsafe()) {
            this.pending.delete(key);
          }
        }
        if (caller) {
          const targets = this.waiting.get(caller) ?? new Set<string>();
          targets.add(key);
          this.waiting.set(caller, targets);
        }
        return yield* restore(
          Deferred.await(completion).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (!caller) {
                  return;
                }
                const targets = this.waiting.get(caller);
                targets?.delete(key);
                if (!targets?.size) {
                  this.waiting.delete(caller);
                }
              })
            )
          )
        );
      })
    );
  }
  trigger(event: string): Effect.Effect<readonly ActivationResult[]> {
    return Effect.suspend(() => {
      this.events.set(event, true);
      return Effect.forEach(
        this.extensions.list().filter((entry) => this.matches(entry, event, true)),
        (entry) => this.activate(entry.id),
        { concurrency: "unbounded" }
      );
    });
  }
  demand(
    requests: readonly AdapterResolutionRequest[]
  ): Effect.Effect<readonly ActivationResult[]> {
    return Effect.suspend(() => {
      const events = new Set<string>();
      for (const request of requests) {
        const prior = this.demands.findIndex((item) => isDeepStrictEqual(item, request));
        if (prior !== -1) {
          this.demands.splice(prior, 1);
        }
        this.demands.push(structuredClone(request));
        if (this.demands.length > this.policy.demandCacheLimit) {
          this.demands.shift();
        }
        events.add(`${ActivationEvent.Feature}:${request.feature.id}`);
        events.add(`${ActivationEvent.Port}:${request.feature.port}`);
        for (const location of request.locations ?? []) {
          events.add(`${ActivationEvent.Location}:${location.type}`);
        }
      }
      const selected = new Set<string>();
      for (const event of events) {
        if (!this.events.has(event)) {
          this.events.set(event, false);
        }
        for (const entry of this.extensions.list()) {
          if (this.matches(entry, event, false)) {
            selected.add(entry.id);
          }
        }
      }
      return Effect.forEach(selected, (id) => this.activate(id), { concurrency: "unbounded" });
    });
  }
  whenIdle(): Effect.Effect<void> {
    return Effect.suspend(() =>
      this.pending.size
        ? Effect.forEach([...this.pending.values()], (fiber) => Fiber.await(fiber), {
            concurrency: "unbounded"
          }).pipe(Effect.andThen(() => this.whenIdle()))
        : Effect.void
    );
  }
  get release(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.closing = true;
      yield* this.policy.beginShutdown;
      for (const generation of this.generations.values()) {
        generation.open = false;
      }
      yield* Scope.close(this.workScope, Exit.void);
      const started = yield* Clock.currentTimeMillis;
      for (const key of [...new Set([...this.activeOrder, ...this.generations.keys()])].reverse()) {
        const entry = this.extensions
          .list()
          .find((item) => `${item.id}@${item.generation}` === key);
        if (entry) {
          yield* this.adapters.clear(entry.id, entry.generation);
          yield* this.extensions.markActivation(
            entry.id,
            entry.generation,
            ActivationStatus.Disposed
          );
        }
        const elapsed = (yield* Clock.currentTimeMillis) - started;
        yield* this.cleanup(
          key,
          Math.max(
            1,
            Math.min(this.policy.budgets.cleanupMs, this.policy.budgets.shutdownMs - elapsed)
          )
        );
      }
      yield* this.resultsChannel.shutdown;
      yield* this.diagnosticsChannel.shutdown;
    });
  }
  private reaches(start: string, target: string, visited = new Set<string>()): boolean {
    if (start === target) {
      return true;
    }
    if (visited.has(start)) {
      return false;
    }
    visited.add(start);
    return [...(this.waiting.get(start) ?? [])].some((next) => this.reaches(next, target, visited));
  }
  private run(entry: ContributionSnapshot): Effect.Effect<ActivationResult> {
    return Effect.gen({ self: this }, function* () {
      const { id, generation } = entry;
      const key = `${id}@${generation}`;
      const scope = yield* Scope.make();
      const owned: Generation = { scope, open: true };
      this.generations.set(key, owned);
      const staged: StagedAdapter[] = [];
      let dependencyBlocked = false;
      let phase: LifecyclePhase = LifecyclePhase.Dependency;
      const started = yield* Clock.currentTimeMillis;
      let phaseStarted = started;
      const work = Effect.gen({ self: this }, function* () {
        const source = yield* infrastructureTry(phase, () =>
          this.extensions.source(id, generation)
        );
        if (source.kind === AdapterOwnerKind.Extension) {
          for (const dependency of source.manifest.dependencies ?? []) {
            const target = this.extensions
              .list()
              .find(
                (item) =>
                  item.owner.kind === AdapterOwnerKind.Extension &&
                  item.owner.id === dependency.extensionId
              );
            if (!target) {
              return yield* Effect.fail(
                new InfrastructureError({
                  phase,
                  message: `Missing Extension dependency: ${dependency.extensionId}`
                })
              );
            }
            const result = yield* this.activate(target.id);
            if (result.status !== ActivationStatus.Active) {
              dependencyBlocked = true;
              return yield* Effect.fail(
                new InfrastructureError({
                  phase,
                  message: `Extension dependency activation failed: ${dependency.extensionId}: ${result.reason}`
                })
              );
            }
          }
        }
        phase = LifecyclePhase.Load;
        phaseStarted = yield* Clock.currentTimeMillis;
        yield* infrastructureTry(phase, () => this.assertCurrent(entry));
        yield* this.extensions.markLoadAttempted(id, generation);
        const loaded = yield* this.policy.bound(
          Effect.suspend(() =>
            requireExtensionEffect(source.load(), "Extension loader must return an Effect")
          ),
          phase,
          this.policy.budgets.loadMs
        );
        const module = yield* infrastructureTry(phase, () =>
          assertExtensionModule(loaded, `Contribution ${id} has no Effect activate function`)
        );
        const context: ExtensionActivationContext = {
          owner: entry.owner,
          registerAdapter: <T>(adapterId: string, port: ImplementationPort<T>, implementation: T) =>
            infrastructureTry(LifecyclePhase.Activation, () => {
              if (!owned.open || this.closing) {
                throw new Error(`Activation context is closed: ${id}`);
              }
              this.assertCurrent(entry);
              if (staged.some((item) => item.id === adapterId)) {
                throw new Error(`Duplicate Adapter implementation: ${adapterId}`);
              }
              staged.push(this.adapters.stage(id, generation, adapterId, port, implementation));
            }),
          dependencyServices: (extensionId) =>
            infrastructureTry(LifecyclePhase.Dependency, () => {
              if (
                source.kind !== AdapterOwnerKind.Extension ||
                !source.manifest.dependencies?.some(
                  (dependency) => dependency.extensionId === extensionId
                )
              ) {
                throw new Error(`Undeclared Extension dependency: ${extensionId}`);
              }
              const dependency = this.extensions
                .list()
                .find(
                  (item) =>
                    item.owner.kind === AdapterOwnerKind.Extension && item.owner.id === extensionId
                );
              const services =
                dependency &&
                this.generations.get(`${dependency.id}@${dependency.generation}`)?.services;
              if (!dependency || dependency.activation !== ActivationStatus.Active || !services) {
                throw new Error(`Extension dependency is not active: ${extensionId}`);
              }
              return services;
            })
        };
        phase = LifecyclePhase.Providers;
        phaseStarted = yield* Clock.currentTimeMillis;
        const layer = yield* infrastructureTry(phase, () => extensionLayer(module, context));
        const root = yield* this.rootServices;
        // Erase requirements only when executing a validated dynamic Extension module.
        const dynamicRoot = root as Context.Context<unknown>;
        const local = layer
          ? yield* this.policy.bound(
              Layer.buildWithScope(layer, scope).pipe(Effect.provideContext(dynamicRoot)),
              phase,
              this.policy.budgets.activationMs
            )
          : Context.empty();
        const services = Context.merge(local, dynamicRoot);
        owned.services = services;
        phase = LifecyclePhase.Activation;
        phaseStarted = yield* Clock.currentTimeMillis;
        const path = yield* ActivationPath;
        yield* this.policy.bound(
          activationEffect(module, context).pipe(
            Effect.provideContext(Context.add(services, Scope.Scope, scope)),
            Effect.provideService(ActivationPath, path)
          ),
          phase,
          this.policy.budgets.activationMs
        );
        yield* Effect.uninterruptible(
          Effect.gen({ self: this }, function* () {
            owned.open = false;
            yield* infrastructureTry(phase, () => this.assertCurrent(entry));
            yield* this.adapters.commit(id, generation, staged);
            yield* this.extensions.markActivation(id, generation, ActivationStatus.Active);
            this.activeOrder.push(key);
          })
        );
        return this.result({
          id,
          generation,
          status: ActivationStatus.Active,
          phase,
          durationMs: (yield* Clock.currentTimeMillis) - started
        });
      });
      return yield* work.pipe(
        Effect.catchCause((cause) =>
          Effect.gen({ self: this }, function* () {
            owned.open = false;
            yield* this.adapters.clear(id, generation);
            const reason = Cause.pretty(cause);
            this.diagnose({
              contributionId: id,
              generation,
              phase,
              reason,
              durationMs: (yield* Clock.currentTimeMillis) - phaseStarted
            });
            yield* this.cleanup(key, this.policy.budgets.cleanupMs);
            const status = this.closing
              ? ActivationStatus.Disposed
              : dependencyBlocked
                ? ActivationStatus.Blocked
                : ActivationStatus.Failed;
            yield* this.extensions.markActivation(id, generation, status, reason);
            if (status === ActivationStatus.Blocked) {
              this.completions.delete(key);
            }
            if (Cause.hasInterrupts(cause)) {
              return yield* Effect.failCause(
                Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason))
              );
            }
            return this.result({
              id,
              generation,
              status,
              phase,
              reason,
              durationMs: (yield* Clock.currentTimeMillis) - started
            });
          })
        )
      );
    });
  }
  private cleanup(key: string, budgetMs: number): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const owned = this.generations.get(key);
      if (!owned) {
        return;
      }
      owned.open = false;
      this.generations.delete(key);
      const started = yield* Clock.currentTimeMillis;
      yield* this.policy
        .bound(Scope.close(owned.scope, Exit.void), LifecyclePhase.Cleanup, budgetMs)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.sync(() => {
              const separator = key.lastIndexOf("@");
              this.diagnose({
                contributionId: key.slice(0, separator),
                generation: Number(key.slice(separator + 1)),
                phase: LifecyclePhase.Cleanup,
                reason: Cause.pretty(cause)
              });
            })
          )
        );
      const elapsed = (yield* Clock.currentTimeMillis) - started;
      if (elapsed > budgetMs) {
        this.diagnose({
          phase: LifecyclePhase.Cleanup,
          reason: `Uninterruptible cleanup exceeded ${budgetMs}ms budget`,
          durationMs: elapsed
        });
      }
    });
  }
  private assertCurrent(entry: ContributionSnapshot): void {
    const current = this.extensions.get(entry.id);
    if (
      this.closing ||
      !current ||
      current.generation !== entry.generation ||
      current.activation !== ActivationStatus.Activating
    ) {
      throw new Error(`Stale activation: ${entry.id}@${entry.generation}`);
    }
  }
  private result(result: ActivationResult): ActivationResult {
    const frozen = Object.freeze(result);
    this.resultsChannel.publish(frozen);
    return frozen;
  }
  private diagnose(diagnostic: LifecycleDiagnostic): void {
    const frozen = Object.freeze(diagnostic);
    this.currentDiagnostics = Object.freeze([...this.currentDiagnostics, frozen]);
    this.diagnosticsChannel.publish(frozen);
  }
  private matches(entry: ContributionSnapshot, event: string, inferred: boolean): boolean {
    if (entry.manifest.activationEvents?.includes(event)) {
      return true;
    }
    if (!inferred) {
      return false;
    }
    const separator = event.indexOf(":");
    const prefix = event.slice(0, separator);
    const value = event.slice(separator + 1);
    const adapters = entry.manifest.contributes?.adapters ?? [];
    if (prefix === ActivationEvent.Port) {
      return adapters.some((adapter) => adapter.port === value);
    }
    if (prefix === ActivationEvent.Location) {
      return (
        entry.manifest.contributes?.locations?.some((location) => location.type === value) ===
          true ||
        adapters.some((adapter) => adapter.locations?.some((location) => location.type === value))
      );
    }
    if (prefix === ActivationEvent.Feature) {
      const feature = this.extensions
        .modules()
        .flatMap((module) => module.features)
        .find((candidate) => candidate.id === value);
      return (
        feature !== undefined && selectAdapters([{ feature }], adapters).resolvedAdapters.length > 0
      );
    }
    return false;
  }
  catalogChanged(): Effect.Effect<void> {
    return this.replay;
  }
  private get replay(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      if (this.closing) {
        return;
      }
      const selected = new Set<string>();
      for (const entry of this.extensions.list()) {
        for (const [event, inferred] of this.events) {
          if (this.matches(entry, event, inferred)) {
            selected.add(entry.id);
          }
        }
      }
      for (const request of this.demands) {
        if (
          request.locations?.some(
            (location) =>
              this.extensions.checkLocation(location).status !== LocationTypeStatus.Supported
          )
        ) {
          continue;
        }
        const declared = selectAdapters([request], this.adapters.descriptors()).resolvedAdapters[0];
        const entry = declared && this.adapters.contributionFor(declared.adapterId);
        if (entry) {
          selected.add(entry.id);
        }
      }
      yield* Effect.forEach(selected, (id) => this.activate(id), {
        concurrency: "unbounded",
        discard: true
      });
    });
  }
}
