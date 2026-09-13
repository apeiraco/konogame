import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import { Cause, Context, Deferred, Effect, Exit, Scope, Stream } from "effect";
import { type AdapterRegistry } from "../registry/adapter-registry.ts";
import {
  type ExtensionRegistry,
  type RegistrationResult,
  RegistrationStatus,
  registerPreparedContribution,
  rejectPreparedContribution
} from "../registry/extension-registry.ts";
import { PublicationChannel } from "../registry/publication-channel.ts";
import { type ExtensionActivationService } from "./activation.ts";
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
import { discoverySourceSchema } from "./discovery-input.ts";
import { ExtensionDiscovery } from "./discovery-refresh.ts";
import { type LifetimePolicy } from "./lifetime.ts";

export const LifecycleStatus = {
  New: "new",
  Preparing: "preparing",
  Prepared: "prepared",
  Initializing: "initializing",
  Ready: "ready",
  Failed: "failed",
  Disposed: "disposed"
} as const;

export type LifecycleStatus = (typeof LifecycleStatus)[keyof typeof LifecycleStatus];

export class EXTENSION_LIFECYCLE extends Context.Service<EXTENSION_LIFECYCLE, ExtensionLifecycle>()(
  "infrastructure.extension-lifecycle"
) {}

export class ExtensionLifecycle {
  private preparation?: Deferred.Deferred<void, InfrastructureError>;
  private initialization?: Deferred.Deferred<void, InfrastructureError>;
  private readonly discovery: ExtensionDiscovery;
  private status: LifecycleStatus = LifecycleStatus.New;
  private currentDiagnostics: readonly LifecycleDiagnostic[] = [];
  private readonly observedActivationDiagnostics = new Set<LifecycleDiagnostic>();
  private constructor(
    private readonly extensions: ExtensionRegistry,
    private readonly adapters: AdapterRegistry,
    private readonly activation: ExtensionActivationService,
    sources: readonly ExtensionDiscoverySource[],
    policy: LifetimePolicy,
    private readonly scope: Scope.Closeable,
    private readonly stateChannel: PublicationChannel<LifecycleStatus>,
    private readonly diagnosticsChannel: PublicationChannel<readonly LifecycleDiagnostic[]>
  ) {
    this.discovery = new ExtensionDiscovery(
      extensions,
      activation,
      sources,
      policy,
      scope,
      (diagnostic) => this.diagnose(diagnostic),
      () => this.diagnostics
    );
  }
  static make(
    extensions: ExtensionRegistry,
    adapters: AdapterRegistry,
    activation: ExtensionActivationService,
    sources: readonly ExtensionDiscoverySource[],
    policy: LifetimePolicy
  ): Effect.Effect<ExtensionLifecycle, InfrastructureError> {
    return Effect.gen(function* () {
      yield* infrastructureTry(LifecyclePhase.Discovery, () => {
        const ids = new Set<string>();
        for (const source of sources) {
          const parsed = discoverySourceSchema(source);
          if (parsed instanceof type.errors || ids.has(parsed.id)) {
            throw new Error(`Invalid or duplicate discovery source: ${String(source?.id)}`);
          }
          ids.add(parsed.id);
        }
      });
      const scope = yield* Scope.make();
      const [stateChannel, diagnosticsChannel] = yield* Effect.all(
        [
          PublicationChannel.make({ value: LifecycleStatus.New as LifecycleStatus }),
          PublicationChannel.make({ value: [] as readonly LifecycleDiagnostic[] })
        ],
        { concurrency: "unbounded" }
      );
      const lifecycle = new ExtensionLifecycle(
        extensions,
        adapters,
        activation,
        [...sources],
        policy,
        scope,
        stateChannel,
        diagnosticsChannel
      );
      yield* Effect.forkIn(
        Stream.runForEach(activation.diagnostics$, (diagnostic) =>
          Effect.sync(() => lifecycle.recordActivationDiagnostic(diagnostic))
        ),
        scope,
        { startImmediately: true }
      );
      return lifecycle;
    });
  }
  get state$() {
    return this.stateChannel.stream;
  }
  get diagnostics$() {
    return this.diagnosticsChannel.stream;
  }
  get snapshot(): LifecycleStatus {
    return this.status;
  }
  get diagnostics(): readonly LifecycleDiagnostic[] {
    return this.currentDiagnostics;
  }
  get catalog(): readonly SourceSnapshot[] {
    return this.discovery.catalog;
  }
  get prepared(): Effect.Effect<void, InfrastructureError> {
    return this.prepare();
  }
  get ready(): Effect.Effect<void, InfrastructureError> {
    return this.initialize();
  }
  prepare(): Effect.Effect<void, InfrastructureError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (this.status === LifecycleStatus.Disposed) {
          return yield* Effect.fail(
            new InfrastructureError({
              phase: LifecyclePhase.Discovery,
              message: "Process is closed"
            })
          );
        }
        if (!this.preparation) {
          this.preparation = Deferred.makeUnsafe<void, InfrastructureError>();
          if (!this.initialization) {
            this.setState(LifecycleStatus.Preparing);
          }
          const target = this.preparation;
          const task = this.discovery.prepare().pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                if (!this.initialization) {
                  this.setState(LifecycleStatus.Prepared);
                }
              })
            ),
            Effect.asVoid,
            Effect.catchCause((cause) =>
              Cause.hasInterrupts(cause)
                ? Effect.failCause(
                    Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason))
                  )
                : Effect.fail(
                    new InfrastructureError({
                      phase: LifecyclePhase.Discovery,
                      message: Cause.pretty(cause),
                      cause
                    })
                  )
            ),
            Effect.onExit((exit) =>
              Effect.gen({ self: this }, function* () {
                if (Exit.isFailure(exit) && this.status !== LifecycleStatus.Disposed) {
                  this.setState(LifecycleStatus.Failed);
                }
                yield* Deferred.done(target, exit);
              })
            )
          );
          const fiber = yield* Effect.forkIn(task, this.scope, { uninterruptible: false });
          fiber.addObserver((exit) => {
            Deferred.doneUnsafe(target, exit);
          });
        }
        return yield* restore(Deferred.await(this.preparation));
      })
    );
  }
  initialize(): Effect.Effect<void, InfrastructureError> {
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen({ self: this }, function* () {
        if (this.status === LifecycleStatus.Disposed) {
          return yield* Effect.fail(
            new InfrastructureError({
              phase: LifecyclePhase.Activation,
              message: "Process is closed"
            })
          );
        }
        if (!this.initialization) {
          this.initialization = Deferred.makeUnsafe<void, InfrastructureError>();
          this.setState(LifecycleStatus.Initializing);
          const target = this.initialization;
          const task = this.prepared.pipe(
            Effect.andThen(() => this.activation.trigger("onStartup")),
            Effect.andThen(() => Effect.sync(() => this.setState(LifecycleStatus.Ready))),
            Effect.onExit((exit) =>
              Effect.gen({ self: this }, function* () {
                if (Exit.isFailure(exit) && this.status !== LifecycleStatus.Disposed) {
                  this.setState(LifecycleStatus.Failed);
                }
                yield* Deferred.done(target, exit);
              })
            )
          );
          const fiber = yield* Effect.forkIn(task, this.scope, { uninterruptible: false });
          fiber.addObserver((exit) => {
            Deferred.doneUnsafe(target, exit);
          });
        }
        return yield* restore(Deferred.await(this.initialization));
      })
    );
  }
  register(
    contributions: readonly Contribution[]
  ): Effect.Effect<RegistrationResult, InfrastructureError> {
    return Effect.gen({ self: this }, function* () {
      yield* this.prepared;
      const ids: string[] = [];
      const failures: string[] = [];
      for (const candidate of contributions) {
        const input = decodeContribution(candidate);
        if (input.status === ContributionInputStatus.Rejected) {
          const reason = String(input.cause);
          yield* rejectPreparedContribution(
            this.extensions,
            input.identity.id ? [input.identity.id] : [],
            input.cause
          );
          this.diagnose({
            contributionId: input.identity.id,
            phase: LifecyclePhase.Registration,
            reason
          });
          if (input.fatal) {
            return yield* Effect.fail(
              new InfrastructureError({
                phase: LifecyclePhase.Registration,
                message: reason,
                cause: input.cause
              })
            );
          }
          failures.push(reason);
          continue;
        }
        const contribution = input.contribution;
        const exit = yield* Effect.exit(
          registerPreparedContribution(this.extensions, contribution)
        );
        if (Exit.isSuccess(exit)) {
          ids.push(contributionId(contribution));
          continue;
        }
        const reason = Cause.pretty(exit.cause);
        this.diagnose({
          contributionId: contributionId(contribution),
          phase: LifecyclePhase.Registration,
          reason
        });
        if (contribution.kind === AdapterOwnerKind.Module) {
          return yield* Effect.failCause(exit.cause);
        }
        failures.push(reason);
      }
      yield* this.activation.catalogChanged();
      yield* this.activation.whenIdle();
      return Object.freeze({
        status: failures.length
          ? ids.length
            ? RegistrationStatus.Partial
            : RegistrationStatus.Rejected
          : RegistrationStatus.Registered,
        ids: Object.freeze(ids),
        catalogVersion: this.extensions.catalogVersion,
        ...(failures.length ? { reason: failures.join("; ") } : {})
      });
    });
  }
  refresh(sourceId?: string): Effect.Effect<RefreshResult, InfrastructureError> {
    return this.discovery.refresh(this.prepared, sourceId);
  }
  private recordActivationDiagnostic(diagnostic: LifecycleDiagnostic): void {
    if (this.observedActivationDiagnostics.has(diagnostic)) {
      return;
    }
    this.observedActivationDiagnostics.add(diagnostic);
    this.diagnose({
      ...diagnostic,
      sourceId: diagnostic.contributionId
        ? this.discovery.sourceFor(diagnostic.contributionId)
        : undefined
    });
  }
  private setState(status: LifecycleStatus): void {
    this.status = status;
    this.stateChannel.publish(status);
  }
  private diagnose(diagnostic: LifecycleDiagnostic): void {
    this.currentDiagnostics = Object.freeze([
      ...this.currentDiagnostics,
      Object.freeze(diagnostic)
    ]);
    this.diagnosticsChannel.publish(this.currentDiagnostics);
  }
  get release(): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      this.setState(LifecycleStatus.Disposed);
      yield* Scope.close(this.scope, Exit.void);
      yield* this.activation.release;
      for (const diagnostic of this.activation.diagnostics) {
        this.recordActivationDiagnostic(diagnostic);
      }
      yield* this.adapters.release;
      yield* this.extensions.release;
      yield* this.stateChannel.shutdown;
      yield* this.diagnosticsChannel.shutdown;
    });
  }
}
