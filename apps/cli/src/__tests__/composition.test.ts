import { expect, it } from "@effect/vitest";
import {
  defineExtensionModule,
  type ExtensionDiscoverySource,
  FEATURE_PLAN
} from "@konogame/infrastructure";
import { Context, Effect, Layer } from "effect";
import { composeCli } from "../main.ts";

class RESOURCE extends Context.Service<RESOURCE, { readonly value: number }>()(
  "test.composition-resource"
) {}

it.effect("application services and overrides share one Scope and finalize once", () =>
  Effect.gen(function* () {
    let runs = 0;
    let acquisitions = 0;
    const overrides = Layer.effect(
      RESOURCE,
      Effect.acquireRelease(
        Effect.sync(() => {
          acquisitions++;
          return { value: 42 };
        }),
        () =>
          Effect.sync(() => {
            runs++;
          })
      )
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const services = yield* Layer.build(composeCli({ catalogOnly: true, overrides }));
        expect(acquisitions).toBe(1);
        expect(runs).toBe(0);
        expect(Context.get(services, FEATURE_PLAN)).toBeDefined();
        expect(acquisitions).toBe(1);
        expect(runs).toBe(0);
      })
    );
    expect(runs).toBe(1);
  })
);

it.effect(
  "catalog composition discovers declarations and ordinary composition activates startup in Scope",
  () =>
    Effect.gen(function* () {
      let activations = 0;
      let cleanups = 0;
      const source: ExtensionDiscoverySource = {
        id: "fixture.composition",
        discover: () =>
          Effect.succeed({
            complete: true,
            contributions: [
              {
                kind: "extension",
                manifest: {
                  id: "fixture.startup",
                  version: "1.0.0",
                  contractRange: "^0.2.0",
                  software: {},
                  activationEvents: ["onStartup"],
                  contributes: {}
                },
                load: () =>
                  Effect.succeed(
                    defineExtensionModule({
                      activate: () =>
                        Effect.gen(function* () {
                          activations++;
                          yield* Effect.addFinalizer(() =>
                            Effect.sync(() => {
                              cleanups++;
                            })
                          );
                        })
                    })
                  )
              }
            ]
          })
      };
      yield* Effect.scoped(
        Layer.build(composeCli({ catalogOnly: true, discoverySources: [source] }))
      );
      expect(activations).toBe(0);
      expect(cleanups).toBe(0);
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(composeCli({ discoverySources: [source] }));
          expect(activations).toBe(1);
          expect(cleanups).toBe(0);
        })
      );
      expect(cleanups).toBe(1);
    })
);
