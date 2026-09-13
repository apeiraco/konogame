import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  DECLARATION_PROTOCOL_RANGE,
  type ExtensionManifest,
  type ImplementationPort
} from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";
import {
  ADAPTER_REGISTRY,
  ADAPTER_RESOLVER,
  type Contribution,
  defineExtensionModule,
  EXTENSION_ACTIVATION,
  EXTENSION_LIFECYCLE,
  EXTENSION_REGISTRY,
  type ExtensionDiscoverySource,
  type ExtensionLoader,
  type ExtensionModule,
  type InfrastructureSettings,
  provideInfrastructure
} from "../index.ts";
export interface TestPort {
  run(): Effect.Effect<string>;
}
export const port: ImplementationPort<TestPort> = {
  id: "synthetic.port",
  operations: { run: "run" },
  is: (value): value is TestPort =>
    !!value && typeof value === "object" && "run" in value && typeof value.run === "function"
};
export const feature = {
  id: "synthetic.run",
  port: port.id,
  operation: "run",
  portVersion: "0.2.0",
  requiredCapabilities: ["synthetic.capability"]
};
export const request = { feature };
export const descriptor = (id: string, priority = 0): AdapterDescriptor => ({
  id: `${id}.adapter`,
  owner: { kind: AdapterOwnerKind.Extension, id },
  port: port.id,
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  portVersionRange: "^0.2.0",
  operations: ["run"],
  capabilities: ["synthetic.capability"],
  priority
});
export function extension(
  id: string,
  options: {
    manifest?: Partial<ExtensionManifest>;
    load?: ExtensionLoader;
    priority?: number;
    module?: ExtensionModule;
  } = {}
): Contribution {
  return {
    kind: AdapterOwnerKind.Extension,
    manifest: {
      id,
      version: "1.0.0",
      declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
      software: {},
      contributes: { adapters: [descriptor(id, options.priority)] },
      ...options.manifest
    },
    load:
      options.load ??
      (() =>
        Effect.succeed(
          options.module ??
            defineExtensionModule({
              activate: (context) =>
                context.registerAdapter(`${id}.adapter`, port, { run: () => Effect.succeed(id) })
            })
        ))
  };
}
export function moduleContribution(id = "synthetic.module"): Contribution {
  return {
    kind: AdapterOwnerKind.Module,
    manifest: { id, declarationProtocolRange: DECLARATION_PROTOCOL_RANGE, features: [feature] },
    load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
  };
}
export const source = (
  contributions: readonly Contribution[],
  id = "synthetic.source"
): ExtensionDiscoverySource => ({
  id,
  discover: () => Effect.succeed({ complete: true, contributions })
});
export function setup(
  contributions: readonly Contribution[] = [],
  settings: InfrastructureSettings = {},
  sources?: readonly ExtensionDiscoverySource[],
  overrides?: Layer.Layer<never>
) {
  const core = provideInfrastructure(settings, sources ?? [source(contributions)]);
  return Layer.build(overrides ? core.pipe(Layer.provide(overrides)) : core).pipe(
    Effect.map((services) => ({
      services,
      lifecycle: Context.get(services, EXTENSION_LIFECYCLE),
      extensions: Context.get(services, EXTENSION_REGISTRY),
      adapters: Context.get(services, ADAPTER_REGISTRY),
      activation: Context.get(services, EXTENSION_ACTIVATION),
      adapterResolver: Context.get(services, ADAPTER_RESOLVER)
    }))
  );
}
export const drain = Effect.repeat(Effect.yieldNow, { times: 10 });
