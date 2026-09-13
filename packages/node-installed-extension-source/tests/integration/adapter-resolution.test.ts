import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import {
  ADAPTER_RESOLVER,
  EXTENSION_LIFECYCLE,
  provideInfrastructure
} from "@konogame/infrastructure";
import { DECLARATION_PROTOCOL_RANGE } from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import {
  installedExtensionFileSystemLayer,
  nodeInstalledExtensionsSource
} from "../../src/index.ts";
import { install, packageDeclaration } from "../support/installed.ts";

it.effect(
  "a real Adapter resolution demand loads an installed ESM factory and publishes its typed implementation",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createTestDirectory(import.meta.dirname, "integration", "adapter-resolution")
        ),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
      );
      const marker = join(root, "marker");
      const declaration = packageDeclaration("fixture.external");
      declaration.manifest.contributes.adapters = [
        {
          id: "fixture.adapter",
          owner: { kind: "extension", id: declaration.manifest.id },
          port: "fixture.port",
          declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
          portVersionRange: "^0.2.0",
          operations: ["run"],
          capabilities: []
        }
      ];
      yield* Effect.promise(() =>
        install(
          root,
          "fixture",
          declaration,
          `import { writeFileSync } from "node:fs";
    export function createExtensionModule() { writeFileSync(${JSON.stringify(marker)}, "factory"); return {
      activate(context) { return context.registerAdapter("fixture.adapter", { id: "fixture.port", is(value) { return typeof value?.run === "function"; }, operations: { run: "run" } }, { run() { return "opaque-result"; } }); }
    }; }`
        )
      );
      const source = yield* nodeInstalledExtensionsSource({
        roots: [root]
      }).pipe(Effect.provide(installedExtensionFileSystemLayer));
      const services = yield* Layer.build(provideInfrastructure({}, [source]));
      const lifecycle = Context.get(services, EXTENSION_LIFECYCLE);
      yield* lifecycle.prepared;
      yield* Effect.promise(() =>
        expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" })
      );
      const adapterResolver = Context.get(services, ADAPTER_RESOLVER);
      const plan = yield* adapterResolver.resolve([
        {
          feature: {
            id: "fixture.feature",
            port: "fixture.port",
            operation: "run",
            portVersion: "0.2.0",
            requiredCapabilities: []
          }
        }
      ]);
      expect(plan.unavailable).toEqual([]);
      expect(yield* Effect.promise(() => readFile(marker, "utf8"))).toBe("factory");
      const port = {
        id: "fixture.port",
        is(value: unknown): value is { run(): string } {
          return Boolean(
            value && typeof value === "object" && "run" in value && typeof value.run === "function"
          );
        }
      };
      expect(adapterResolver.implementation(plan.resolvedAdapters[0]!, port)?.run()).toBe(
        "opaque-result"
      );
    })
);
