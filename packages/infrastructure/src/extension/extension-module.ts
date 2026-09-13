import { Effect, Layer } from "effect";
import { type ExtensionActivationContext, type ExtensionModule } from "./activation-contract.ts";
import { observeNativePromise, requireExtensionEffect } from "./callback-result.ts";

/** Pack the inferred static environment only where implementation modules become heterogeneous. */
export function defineExtensionModule<const Module extends ExtensionModule>(
  module: Module
): Module {
  return module;
}

export function assertExtensionModule(value: unknown, message: string): ExtensionModule {
  if (
    !value ||
    (typeof value !== "object" && typeof value !== "function") ||
    observeNativePromise(value)
  ) {
    throw new Error(message);
  }
  const activate = Reflect.get(value, "activate");
  if (typeof activate !== "function") {
    throw new Error(message);
  }
  const layer = Reflect.get(value, "layer");
  if (layer !== undefined && typeof layer !== "function" && !Layer.isLayer(layer)) {
    observeNativePromise(layer);
    throw new Error(message);
  }
  // Capture executable members once; factories and methods retain their original receiver.
  return {
    ...(layer === undefined
      ? {}
      : { layer: typeof layer === "function" ? layer.bind(value) : layer }),
    activate: activate.bind(value)
  };
}

export function extensionLayer(
  module: ExtensionModule,
  context: ExtensionActivationContext
): Layer.Layer<never, unknown, unknown> | undefined {
  if (typeof module.layer !== "function") {
    return module.layer;
  }
  const layer = module.layer(context);
  if (!Layer.isLayer(layer)) {
    observeNativePromise(layer);
    throw new Error("Extension service layer factory must return a Layer");
  }
  return layer;
}

export function activationEffect(
  module: ExtensionModule,
  context: ExtensionActivationContext
): Effect.Effect<void, unknown, unknown> {
  return Effect.suspend(() =>
    requireExtensionEffect(module.activate(context), "Extension activation must return an Effect")
  );
}
