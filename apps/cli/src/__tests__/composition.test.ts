import { expect, it } from "@effect/vitest";
import {
  workspaceTomlConfigurationAdapter,
  workspaceTomlManifest
} from "@konogame/extension-workspace-toml";
import {
  ADAPTER_RESOLUTION_PLANNER,
  defineExtensionModule,
  EXTENSION_CATALOG,
  type ExtensionDiscoverySource
} from "@konogame/infrastructure";
import { WorkspaceFeature } from "@konogame/workspace/contracts";
import { Context, Effect, Layer } from "effect";
import { composeCli } from "../main.ts";

class RESOURCE extends Context.Service<RESOURCE, { readonly value: number }>()(
  "test.composition-resource"
) {}

it.effect("composeCli selects the bundled TOML Extension for configuration on demand", () =>
  Effect.gen(function* () {
    const services = yield* Layer.build(composeCli());
    const catalog = Context.get(services, EXTENSION_CATALOG);
    expect(
      (yield* catalog.list()).find(({ id }) => id === workspaceTomlManifest.id)?.activation
    ).not.toBe("active");
    const plan = yield* Context.get(services, ADAPTER_RESOLUTION_PLANNER).plan([
      WorkspaceFeature.Inspect
    ]);
    expect(plan.unavailable).toEqual([]);
    expect(plan.resolvedAdapters[0]?.adapterId).toBe(workspaceTomlConfigurationAdapter.id);
    expect(plan.resolvedAdapters[0]?.owner).toEqual(workspaceTomlConfigurationAdapter.owner);
    expect(
      (yield* catalog.list()).find(({ id }) => id === workspaceTomlManifest.id)?.activation
    ).toBe("active");
  })
);

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
        expect(Context.get(services, ADAPTER_RESOLUTION_PLANNER)).toBeDefined();
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

for (const [capability, expected] of [
  ["discovery.source.standalone", ["konogame.filesystem"]],
  ["discovery.source.steam", ["konogame.filesystem", "konogame.steam"]]
] as const) {
  it.effect(
    `composeCli lazily activates only the selected discovery implementation and its dependencies for ${capability}`,
    () =>
      Effect.gen(function* () {
        const services = yield* Layer.build(composeCli());
        const plan = Context.get(services, ADAPTER_RESOLUTION_PLANNER);
        const catalog = Context.get(services, EXTENSION_CATALOG);
        yield* plan.features();
        expect(
          (yield* catalog.list())
            .filter((entry) => entry.activation === "active")
            .map((entry) => entry.id)
        ).toEqual([]);
        const result = yield* plan.plan(["game.discover"], {}, { "game.discover": [capability] });
        expect(result.resolvedAdapters).toHaveLength(1);
        expect(
          (yield* catalog.list())
            .filter((entry) => entry.activation === "active")
            .map((entry) => entry.id)
        ).toEqual(expected);
      })
  );
}
