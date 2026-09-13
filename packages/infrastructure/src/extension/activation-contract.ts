import { type AdapterOwner, type ImplementationPort } from "@konogame/infrastructure/contracts";
import { type Context, type Effect, type Layer } from "effect";
import { type InfrastructureError, type LifecyclePhase } from "./diagnostics.ts";

export interface ExtensionActivationContext {
  readonly owner: AdapterOwner;
  registerAdapter<T>(
    id: string,
    port: ImplementationPort<T>,
    implementation: T
  ): Effect.Effect<void, InfrastructureError>;
  dependencyServices(
    extensionId: string
  ): Effect.Effect<Context.Context<unknown>, InfrastructureError>;
}

/** Existential environment is confined to the dynamic contribution boundary. */
export interface ExtensionModule {
  readonly layer?:
    | Layer.Layer<never, unknown, unknown>
    | ((context: ExtensionActivationContext) => Layer.Layer<never, unknown, unknown>);
  activate(context: ExtensionActivationContext): Effect.Effect<void, unknown, unknown>;
}

export type ExtensionLoader<Module = unknown> = () => Effect.Effect<Module, unknown>;

export const ActivationStatus = {
  Inactive: "inactive",
  Blocked: "blocked",
  Activating: "activating",
  Active: "active",
  Failed: "failed",
  Disposed: "disposed"
} as const;

export type ActivationStatus = (typeof ActivationStatus)[keyof typeof ActivationStatus];

export const ActivationEvent = {
  Startup: "onStartup",
  Feature: "onFeature",
  Port: "onPort",
  Location: "onLocation"
} as const;

export type ActivationEvent = (typeof ActivationEvent)[keyof typeof ActivationEvent];

export interface ActivationResult {
  id: string;
  generation: number;
  status: ActivationStatus;
  reason?: string;
  phase?: LifecyclePhase;
  durationMs?: number;
  cause?: string;
}
