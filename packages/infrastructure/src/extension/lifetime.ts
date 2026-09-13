import { Clock, Context, Effect, type Scope } from "effect";
import { InfrastructureError, LifecyclePhase } from "./diagnostics.ts";

export class LIFETIME_POLICY extends Context.Service<LIFETIME_POLICY, LifetimePolicy>()(
  "infrastructure.lifetime-policy"
) {}

export interface LifetimeBudgets {
  discoveryMs: number;
  loadMs: number;
  activationMs: number;
  shutdownMs: number;
  cleanupMs: number;
}

export interface InfrastructureSettings {
  budgets?: Partial<LifetimeBudgets>;
  demandCacheLimit?: number;
}

export class LifetimePolicy {
  readonly budgets: Readonly<LifetimeBudgets>;
  readonly demandCacheLimit: number;
  private shutdownDeadline = Number.POSITIVE_INFINITY;
  constructor(settings: InfrastructureSettings = {}) {
    this.budgets = Object.freeze({
      discoveryMs: 15_000,
      loadMs: 15_000,
      activationMs: 30_000,
      shutdownMs: 5_000,
      cleanupMs: 1_000,
      ...settings.budgets
    });
    for (const [name, value] of Object.entries(this.budgets)) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
        throw new Error(`Invalid lifetime budget: ${name}`);
      }
    }
    this.demandCacheLimit = settings.demandCacheLimit ?? 256;
    if (!Number.isSafeInteger(this.demandCacheLimit) || this.demandCacheLimit <= 0) {
      throw new Error("Invalid demand cache limit");
    }
  }
  get beginShutdown(): Effect.Effect<void> {
    return Effect.map(Clock.currentTimeMillis, (now) => {
      this.shutdownDeadline = now + this.budgets.shutdownMs;
    });
  }
  finalizer<R>(cleanup: Effect.Effect<void, never, R>): Effect.Effect<void, never, R> {
    return Effect.gen({ self: this }, function* () {
      const now = yield* Clock.currentTimeMillis;
      const budget = Math.max(0, Math.min(this.budgets.cleanupMs, this.shutdownDeadline - now));
      yield* this.bound(Effect.interruptible(cleanup), LifecyclePhase.Cleanup, budget).pipe(
        Effect.orDie
      );
    });
  }
  bound<A, E, R>(
    task: Effect.Effect<A, E, R>,
    phase: LifecyclePhase,
    budgetMs: number
  ): Effect.Effect<A, E | InfrastructureError, R> {
    return task.pipe(
      Effect.timeoutOrElse({
        duration: budgetMs,
        orElse: () =>
          Effect.fail(
            new InfrastructureError({
              phase,
              message: `${phase} exceeded ${budgetMs}ms deadline`
            })
          )
      })
    );
  }
}

/** Use a native Scope finalizer with cooperative cleanup deadlines and preserved defects. */

export function addLifetimeFinalizer<R>(
  cleanup: Effect.Effect<void, never, R>
): Effect.Effect<void, never, R | Scope.Scope | LIFETIME_POLICY> {
  return Effect.gen(function* () {
    const policy = yield* LIFETIME_POLICY;
    yield* Effect.addFinalizer(() => policy.finalizer(cleanup));
  });
}
