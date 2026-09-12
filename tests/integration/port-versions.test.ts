import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { it } from "@effect/vitest";
import { filesystemManifest } from "@konogame/extension-filesystem/manifest";
import { filesystemExtensionSource } from "@konogame/extension-filesystem/providers";
import { gameModule } from "@konogame/game/contracts";
import {
  ADAPTER_RESOLVER,
  defineExtensionModule,
  provideInfrastructure
} from "@konogame/infrastructure";
import { LOCATION_BEHAVIOR_PORT } from "@konogame/infrastructure/contracts";
import { saveModule } from "@konogame/save/contracts";
import { Context, Effect, Layer } from "effect";
import { createTestDirectory } from "../support/temp.ts";

it.live(
  "a host discovery Port upgrade preserves released ranges and the other Port workflows",
  () =>
    Effect.gen(function* () {
      const saveRoot = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createTestDirectory(import.meta.dirname, "integration", "port-versions")
        ),
        (root) =>
          Effect.promise(() => rm(root, { recursive: true, force: true })).pipe(Effect.orDie)
      );
      const discovery = gameModule.features[0]!;
      const store = saveModule.features.find((item) => item.id === "save.store")!;
      const location = {
        id: "location.validate",
        port: "location.behavior",
        portVersion: LOCATION_BEHAVIOR_PORT.version,
        operation: "validate",
        requiredCapabilities: ["location.validation"]
      };
      const published = structuredClone(filesystemManifest);
      for (const version of [discovery.portVersion, "0.4.0"]) {
        const hostDiscovery = { ...discovery, portVersion: version };
        const services = yield* Layer.build(
          provideInfrastructure({}, [
            filesystemExtensionSource({ saveRoot }),
            {
              id: "modules:host-ports",
              discover: () =>
                Effect.succeed({
                  complete: true,
                  contributions: [gameModule, saveModule].map((module) => ({
                    kind: "module" as const,
                    manifest:
                      module.id === gameModule.id
                        ? { ...module, features: [hostDiscovery] }
                        : module,
                    load: () =>
                      Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
                  }))
                })
            }
          ])
        );
        const adapterResolver = Context.get(services, ADAPTER_RESOLVER);
        const plan = yield* adapterResolver.resolve(
          [hostDiscovery, store, location].map((feature) => ({ feature }))
        );
        assert.deepEqual(
          plan.resolvedAdapters.map((resolvedAdapter) => resolvedAdapter.port),
          version === discovery.portVersion
            ? ["game.discovery", "save.store", "location.behavior"]
            : ["save.store", "location.behavior"]
        );
        assert.equal(plan.unavailable.length, version === discovery.portVersion ? 0 : 1);
        const storeAdapter = plan.resolvedAdapters.find(
          (resolvedAdapter) => resolvedAdapter.port === "save.store"
        )!;
        assert.equal(storeAdapter.portVersion, store.portVersion);
        assert.equal(storeAdapter.portVersionRange, ">=0.2.0 <0.3.0");
      }
      assert.deepEqual(filesystemManifest, published);
    })
);
