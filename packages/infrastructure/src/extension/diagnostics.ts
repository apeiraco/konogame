import { type } from "arktype";
import { Data, Effect } from "effect";

export const LifecyclePhase = {
  Discovery: "discovery",
  Registration: "registration",
  Dependency: "dependency",
  Load: "load",
  Providers: "providers",
  Activation: "activation",
  Cleanup: "cleanup",
  Shutdown: "shutdown"
} as const;

export type LifecyclePhase = (typeof LifecyclePhase)[keyof typeof LifecyclePhase];

export interface LifecycleDiagnostic {
  sourceId?: string;
  contributionId?: string;
  generation?: number;
  phase: LifecyclePhase;
  reason: string;
  cause?: string;
  durationMs?: number;
}

export const lifecycleDiagnosticSchema = type({
  "+": "reject",
  "sourceId?": "string",
  "contributionId?": "string",
  "cause?": "string",
  "generation?": type("number.integer >= 0").narrow(
    (value, ctx) => Number.isSafeInteger(value) || ctx.mustBe("a safe generation")
  ),
  phase: type.enumerated(...Object.values(LifecyclePhase)),
  reason: "string",
  "durationMs?": type.number
    .atLeast(0)
    .narrow((value, ctx) => Number.isFinite(value) || ctx.mustBe("a finite duration"))
});

export class InfrastructureError extends Data.TaggedError("InfrastructureError")<{
  readonly phase: LifecyclePhase;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export function infrastructureTry<A>(
  phase: LifecyclePhase,
  task: () => A
): Effect.Effect<A, InfrastructureError> {
  return Effect.try({
    try: task,
    catch: (cause) => new InfrastructureError({ phase, message: String(cause), cause })
  });
}
