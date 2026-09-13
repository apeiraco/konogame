import { expect, it } from "@effect/vitest";
import {
  ADAPTER_RESOLUTION_PLANNER,
  ADAPTER_RESOLVER,
  type AdapterResolutionPlanner,
  type Contribution,
  defineExtensionModule,
  EXTENSION_LIFECYCLE,
  LOCATION_BEHAVIOR,
  provideAdapterResolutionPlanner,
  provideInfrastructure
} from "@konogame/infrastructure";
import { type AdapterDescriptor, locationImplementation } from "@konogame/infrastructure/contracts";
import { saveModuleSource, saveStoreImplementation } from "@konogame/save";
import { Context, Effect, Layer } from "effect";

it.effect("Location behavior initializes and binds independently of the application graph", () =>
  Effect.gen(function* () {
    let activations = 0;
    const descriptor: AdapterDescriptor = {
      id: "fixture.location",
      owner: { kind: "extension", id: "fixture" },
      port: "location.behavior",
      declarationProtocolRange: "^0.2.0",
      portVersionRange: "^0.2.0",
      operations: ["validate"],
      capabilities: ["location.validation"],
      locations: [{ type: "fixture.object", schemaRange: "1.x" }]
    };
    const contribution: Contribution = {
      kind: "extension",
      manifest: {
        id: "fixture",
        version: "1.0.0",
        declarationProtocolRange: "^0.2.0",
        software: {},
        contributes: {
          adapters: [descriptor],
          locations: [
            {
              type: "fixture.object",
              schemaVersion: "1.0.0",
              schemaRange: "1.x",
              dataSchema: { type: "string" }
            }
          ]
        }
      },
      load: () =>
        Effect.succeed(
          defineExtensionModule({
            activate: (context) =>
              Effect.gen(function* () {
                activations++;
                yield* context.registerAdapter(descriptor.id, locationImplementation, {
                  validate: () => Effect.succeed({ status: "valid" })
                });
              })
          })
        )
    };
    const services = yield* Layer.build(
      provideInfrastructure({}, [
        {
          id: "fixture",
          discover: () => Effect.succeed({ complete: true, contributions: [contribution] })
        }
      ])
    );
    const locations = Context.get(services, LOCATION_BEHAVIOR);
    expect(activations).toBe(0);
    expect(
      yield* locations.validate({
        location: { type: "fixture.object", schemaVersion: "1.0.0", data: "opaque" }
      })
    ).toEqual({ status: "valid" });
    expect(activations).toBe(1);
    expect(Context.getOption(services, ADAPTER_RESOLUTION_PLANNER)._tag).toBe("None");
    expect(Context.get(services, ADAPTER_RESOLVER).modules()).toEqual([]);
  })
);
it.effect(
  "startup activation can request another Feature through the application without waiting for itself",
  () =>
    Effect.gen(function* () {
      const descriptor: AdapterDescriptor = {
        id: "fixture.save",
        owner: { kind: "extension", id: "fixture.save" },
        port: "save.store",
        declarationProtocolRange: "^0.2.0",
        portVersionRange: "^0.2.0",
        operations: ["put", "open"],
        capabilities: ["artifact.multifile", "artifact.streaming"]
      };
      let selected: string | undefined;
      let app: AdapterResolutionPlanner;
      const contributions: Contribution[] = [
        {
          kind: "extension",
          manifest: {
            id: "fixture.startup",
            version: "1.0.0",
            declarationProtocolRange: "^0.2.0",
            software: {},
            activationEvents: ["onStartup"],
            contributes: {}
          },
          load: () =>
            Effect.succeed(
              defineExtensionModule({
                activate: () =>
                  Effect.gen(function* () {
                    selected = (yield* app.plan(["save.store"])).resolvedAdapters[0]?.adapterId;
                  })
              })
            )
        },
        {
          kind: "extension",
          manifest: {
            id: "fixture.save",
            version: "1.0.0",
            declarationProtocolRange: "^0.2.0",
            software: {},
            contributes: { adapters: [descriptor] }
          },
          load: () =>
            Effect.succeed(
              defineExtensionModule({
                activate: (context) =>
                  context.registerAdapter(descriptor.id, saveStoreImplementation, {
                    put: () => Effect.die(new Error("Unused")),
                    open: () => Effect.die(new Error("Unused"))
                  })
              })
            )
        }
      ];
      const core = provideInfrastructure({}, [
        saveModuleSource(),
        { id: "fixture", discover: () => Effect.succeed({ complete: true, contributions }) }
      ]);
      const services = yield* Layer.build(
        provideAdapterResolutionPlanner().pipe(Layer.provideMerge(core))
      );
      app = Context.get(services, ADAPTER_RESOLUTION_PLANNER);
      yield* Context.get(services, EXTENSION_LIFECYCLE).ready;
      expect(selected).toBe(descriptor.id);
    })
);
