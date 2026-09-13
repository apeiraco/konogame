import { expect, it } from "@effect/vitest";
import {
  addLifetimeFinalizer,
  defineExtensionModule,
  EXTENSION_LIFECYCLE,
  EXTENSION_REGISTRY,
  provideInfrastructure
} from "@konogame/infrastructure";
import { type AdapterDescriptor } from "@konogame/infrastructure/contracts";
import {
  SAVE_STORE,
  type SaveStorePort,
  saveModuleSource,
  saveStoreImplementation
} from "@konogame/save";
import { Context, Effect, Exit, Layer, Scope, Stream } from "effect";
import { provideOwnerLayers, useCases } from "../../../../tests/support/use-cases.ts";

it.effect(
  "a running application discovers once, accepts a later implementation, and requires restart for removal",
  () =>
    Effect.gen(function* () {
      let discoveries = 0,
        loads = 0,
        writes = 0,
        cleanups = 0;
      const store: SaveStorePort = {
        put: () =>
          Effect.sync(() => {
            writes++;
            return { id: "019a0000-0000-7000-8000-000000000001", mediaType: "fixture/opaque" };
          }),
        open: () => Effect.die(new Error("Unused"))
      };
      const owned = yield* Scope.fork(yield* Effect.scope);
      const core = provideInfrastructure({}, [
        saveModuleSource(),
        {
          id: "fixture.discovery",
          discover: () =>
            Effect.sync(() => {
              discoveries++;
              return { complete: true, contributions: [] };
            })
        }
      ]).pipe(Layer.provide(Layer.succeed(SAVE_STORE, store)));
      const services = yield* Layer.buildWithScope(provideOwnerLayers(core), owned);
      const app = useCases(services),
        lifecycle = Context.get(services, EXTENSION_LIFECYCLE),
        registry = Context.get(services, EXTENSION_REGISTRY);
      expect(discoveries).toBe(0);
      expect(yield* app.plan.features()).toContain("save.store");
      expect(discoveries).toBe(1);
      expect((yield* app.plan.plan(["save.store"])).unavailable).toHaveLength(1);
      const descriptor: AdapterDescriptor = {
        id: "fixture.save-store",
        owner: { kind: "extension", id: "fixture" },
        port: "save.store",
        declarationProtocolRange: "^0.2.0",
        portVersionRange: "^0.2.0",
        operations: ["put", "open"],
        capabilities: ["artifact.multifile", "artifact.streaming"]
      };
      const registration = yield* lifecycle.register([
        {
          kind: "extension",
          manifest: {
            id: "fixture",
            version: "1.0.0",
            declarationProtocolRange: "^0.2.0",
            software: {},
            contributes: { adapters: [descriptor] }
          },
          load: () =>
            Effect.sync(() => {
              loads++;
              return defineExtensionModule({
                activate: (context) =>
                  Effect.gen(function* () {
                    yield* context.registerAdapter(
                      descriptor.id,
                      saveStoreImplementation,
                      yield* SAVE_STORE
                    );
                    yield* addLifetimeFinalizer(
                      Effect.sync(() => {
                        cleanups++;
                      })
                    );
                  })
              });
            })
        }
      ]);
      expect(registration.status).toBe("registered");
      expect(loads).toBe(1);
      expect((yield* app.plan.plan(["save.store"])).resolvedAdapters[0]?.adapterId).toBe(
        descriptor.id
      );
      yield* app.save.storeSave({ mediaType: "fixture/opaque", files: Stream.empty });
      expect(writes).toBe(1);
      expect((yield* registry.remove("fixture")).status).toBe("restart-service-required");
      expect(discoveries).toBe(1);
      yield* Scope.close(owned, Exit.void);
      expect(cleanups).toBe(1);
    })
);
