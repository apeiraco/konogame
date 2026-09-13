import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it as test } from "@effect/vitest";
import {
  ActivationStatus,
  EXTENSION_ACTIVATION,
  EXTENSION_LIFECYCLE,
  LifecyclePhase,
  provideInfrastructure
} from "@konogame/infrastructure";
import { Cause, Context, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { NodeInstalledExtensionFileSystem } from "../../src/filesystem.ts";
import {
  EXTENSION_PACKAGE_BYTE_LIMIT,
  EXTENSION_PACKAGE_COUNT_LIMIT,
  EXTENSION_PACKAGE_FILENAME,
  NodeInstalledExtensionSource,
  parseExtensionPackage,
  parseExtensionRoots
} from "../../src/index.ts";
import { nativePromise, rejects } from "../support/effects.ts";
import { install, packageDeclaration } from "../support/installed.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const directory = () =>
  createTestDirectory(import.meta.dirname, "integration", "installed").then((root) => {
    roots.push(root);
    return root;
  });

test.effect("scan is deterministic, stable, and does not import entry code until demand", () =>
  Effect.gen(function* () {
    const root = yield* nativePromise(directory());
    const marker = join(root, "marker");
    yield* nativePromise(install(root, "zeta"));
    yield* nativePromise(
      install(
        root,
        "alpha",
        packageDeclaration("alpha"),
        `import { Effect } from "effect"; import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "loaded"); export function createExtensionModule(options) { if (options.value !== 7) throw new Error("options"); return { activate: () => Effect.void }; }`
      )
    );
    const declaration = packageDeclaration("alpha");
    declaration.module.options = { value: 7 };
    yield* nativePromise(
      writeFile(join(root, "alpha", EXTENSION_PACKAGE_FILENAME), JSON.stringify(declaration))
    );
    const source = new NodeInstalledExtensionSource(
      { roots: [root] },
      new NodeInstalledExtensionFileSystem()
    );
    const first = yield* source.discover();
    const second = yield* source.discover();
    expect(first.complete).toBe(true);
    expect(first.contributions.map((item) => item.manifest.id)).toEqual(["alpha", "zeta"]);
    expect(second.contributions.map((item) => item.revision)).toEqual(
      first.contributions.map((item) => item.revision)
    );
    yield* nativePromise(expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" }));
    yield* first.contributions[0]!.load();
    expect(yield* nativePromise(readFile(marker, "utf8"))).toBe("loaded");
  })
);

test.effect(
  "bad packages and all same-source duplicate IDs are isolated without selecting a winner",
  () =>
    Effect.gen(function* () {
      const root = yield* nativePromise(directory());
      yield* nativePromise(install(root, "valid"));
      yield* nativePromise(install(root, "duplicate-a", packageDeclaration("duplicate")));
      yield* nativePromise(install(root, "duplicate-b", packageDeclaration("duplicate")));
      yield* nativePromise(install(root, "bad-json"));
      yield* nativePromise(writeFile(join(root, "bad-json", EXTENSION_PACKAGE_FILENAME), "{"));
      yield* nativePromise(install(root, "missing-entry"));
      yield* nativePromise(rm(join(root, "missing-entry", "dist", "extension.mjs")));
      const batch = yield* new NodeInstalledExtensionSource(
        { roots: [root] },
        new NodeInstalledExtensionFileSystem()
      ).discover();
      expect(batch.complete).toBe(false);
      expect(batch.contributions.map((item) => item.manifest.id)).toEqual(["valid"]);
      expect(batch.diagnostics).toHaveLength(3);
      expect(batch.diagnostics?.some((item) => item.contributionId === "duplicate")).toBe(true);
    })
);

for (const entry of [
  "../escape.mjs",
  "./../escape.mjs",
  "file:///entry.mjs",
  "C:/entry.mjs",
  "./dist\\entry.mjs",
  "./dist//entry.mjs"
]) {
  test(`package boundary rejects entry ${entry}`, () => {
    const declaration = packageDeclaration("fixture");
    declaration.module.entry = entry;
    expect(() => parseExtensionPackage(JSON.stringify(declaration))).toThrow();
  });
}
test("package boundary rejects unknown fields, nonportable values, and invalid factory/version", () => {
  const declared = packageDeclaration("fixture");
  for (const value of [
    { ...declared, extra: true },
    { ...declared, schemaVersion: "extension.package.2" },
    { ...declared, module: { ...declared.module, factory: "x.y" } },
    { ...declared, module: { ...declared.module, options: null } },
    {
      ...declared,
      module: { ...declared.module, options: 9007199254740992 }
    }
  ]) {
    expect(() => parseExtensionPackage(JSON.stringify(value))).toThrow();
  }
  expect(() => parseExtensionRoots('["relative"]')).toThrow();
  expect(() => parseExtensionRoots("{}")).toThrow();
  expect(parseExtensionRoots(undefined)).toEqual([]);
});

test.effect(
  "oversized manifests, inaccessible roots, and cancellation produce no executable entries",
  () =>
    Effect.gen(function* () {
      const root = yield* nativePromise(directory());
      const installed = yield* nativePromise(install(root, "large"));
      yield* nativePromise(
        writeFile(
          join(installed, EXTENSION_PACKAGE_FILENAME),
          " ".repeat(EXTENSION_PACKAGE_BYTE_LIMIT + 1)
        )
      );
      const batch = yield* new NodeInstalledExtensionSource(
        {
          roots: [root, join(root, "missing")]
        },
        new NodeInstalledExtensionFileSystem()
      ).discover();
      expect(batch.complete).toBe(false);
      expect(batch.diagnostics).toHaveLength(2);
      expect(batch.contributions).toEqual([]);
      const entered = yield* Deferred.make<void>();
      class WaitingFileSystem extends NodeInstalledExtensionFileSystem {
        override realPath(_path: string): Effect.Effect<string> {
          return Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never));
        }
      }
      const running = yield* Effect.forkScoped(
        new NodeInstalledExtensionSource({ roots: [root] }, new WaitingFileSystem()).discover()
      );
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(running);
      const cancelled = yield* Fiber.await(running);
      expect(Exit.isFailure(cancelled) && Cause.hasInterrupts(cancelled.cause)).toBe(true);
    })
);

test.effect(
  "an over-limit directory scan is incomplete and never selects an arbitrary subset",
  () =>
    Effect.gen(function* () {
      const root = yield* nativePromise(directory());
      yield* nativePromise(
        Promise.all(
          Array.from({ length: EXTENSION_PACKAGE_COUNT_LIMIT + 1 }, (_, index) =>
            mkdir(join(root, `package-${index}`))
          )
        )
      );
      const batch = yield* new NodeInstalledExtensionSource(
        { roots: [root] },
        new NodeInstalledExtensionFileSystem()
      ).discover();
      expect(batch.complete).toBe(false);
      expect(batch.contributions).toEqual([]);
      expect(batch.diagnostics?.[0]?.reason).toContain("package limit");
    })
);

test.effect(
  "entry and package symlinks cannot escape configured roots and are rechecked before loading",
  () =>
    Effect.gen(function* () {
      const root = yield* nativePromise(directory());
      const outside = yield* nativePromise(directory());
      const escaped = yield* nativePromise(install(outside, "outside"));
      yield* nativePromise(
        symlink(escaped, join(root, "escape"), process.platform === "win32" ? "junction" : "dir")
      );
      const valid = yield* nativePromise(install(root, "valid"));
      const source = new NodeInstalledExtensionSource(
        { roots: [root] },
        new NodeInstalledExtensionFileSystem()
      );
      const batch = yield* source.discover();
      expect(batch.complete).toBe(false);
      expect(batch.contributions).toHaveLength(1);
      yield* nativePromise(rm(join(valid, "dist"), { recursive: true }));
      yield* nativePromise(
        symlink(
          join(escaped, "dist"),
          join(valid, "dist"),
          process.platform === "win32" ? "junction" : "dir"
        )
      );
      yield* rejects(batch.contributions[0]!.load(), "escapes");
    })
);

test.effect("changed manifests or code after discovery cannot execute stale observations", () =>
  Effect.gen(function* () {
    const root = yield* nativePromise(directory());
    const installed = yield* nativePromise(install(root, "fixture"));
    const source = new NodeInstalledExtensionSource(
      { roots: [root] },
      new NodeInstalledExtensionFileSystem()
    );
    const first = yield* source.discover();
    yield* nativePromise(
      writeFile(
        join(installed, "dist", "extension.mjs"),
        "throw new Error('must not execute stale code')"
      )
    );
    yield* rejects(first.contributions[0]!.load(), "changed after discovery");
    const second = yield* source.discover();
    expect(second.contributions[0]!.revision).not.toBe(first.contributions[0]!.revision);
    yield* nativePromise(
      writeFile(
        join(installed, EXTENSION_PACKAGE_FILENAME),
        JSON.stringify({
          ...packageDeclaration("fixture"),
          module: { entry: "./dist/extension.mjs", factory: "other" }
        })
      )
    );
    yield* rejects(second.contributions[0]!.load(), "changed after discovery");
  })
);

test.effect(
  "failed imports retain the Node ESM cache boundary and changed code requires restart",
  () =>
    Effect.gen(function* () {
      const root = yield* nativePromise(directory());
      const installed = yield* nativePromise(
        install(
          root,
          "fixture",
          packageDeclaration("fixture"),
          "throw new Error('synthetic import failure');"
        )
      );
      const source = new NodeInstalledExtensionSource(
        { roots: [root] },
        new NodeInstalledExtensionFileSystem()
      );
      const first = yield* source.discover();
      yield* rejects(first.contributions[0]!.load(), "synthetic import failure");
      yield* nativePromise(
        writeFile(
          join(installed, "dist", "extension.mjs"),
          'import { Effect } from "effect"; export function createExtensionModule() { return { activate: () => Effect.void }; }'
        )
      );
      const second = yield* new NodeInstalledExtensionSource(
        { roots: [root] },
        new NodeInstalledExtensionFileSystem()
      ).discover();
      expect(second.restartRequired).toEqual(["fixture"]);
      expect(second.contributions).toEqual([]);
      expect(second.complete).toBe(false);
      const aliases = yield* nativePromise(directory());
      const alias = join(aliases, "alias");
      yield* nativePromise(symlink(root, alias, process.platform === "win32" ? "junction" : "dir"));
      const byAlias = yield* new NodeInstalledExtensionSource(
        { roots: [alias] },
        new NodeInstalledExtensionFileSystem()
      ).discover();
      expect(byAlias.restartRequired).toEqual(["fixture"]);
      if (process.platform === "win32") {
        const byCase = yield* new NodeInstalledExtensionSource(
          { roots: [root.toUpperCase()] },
          new NodeInstalledExtensionFileSystem()
        ).discover();
        expect(byCase.restartRequired).toEqual(["fixture"]);
      }
    })
);

test.effect("missing or throwing factories fail only when their loader is requested", () =>
  Effect.gen(function* () {
    const root = yield* nativePromise(directory());
    yield* nativePromise(
      install(root, "missing", packageDeclaration("missing"), "export const different = 1;")
    );
    yield* nativePromise(
      install(
        root,
        "throwing",
        packageDeclaration("throwing"),
        "export function createExtensionModule() { throw new Error('factory failure'); }"
      )
    );
    const batch = yield* new NodeInstalledExtensionSource(
      { roots: [root] },
      new NodeInstalledExtensionFileSystem()
    ).discover();
    expect(batch.complete).toBe(true);
    yield* rejects(batch.contributions[0]!.load(), "not callable");
    yield* rejects(batch.contributions[1]!.load(), "factory failure");
  })
);

test.effect("an async factory is rejected and its late Promise rejection is consumed", () =>
  Effect.gen(function* () {
    const root = yield* nativePromise(directory());
    yield* nativePromise(
      install(
        root,
        "legacy-async",
        packageDeclaration("legacy-async"),
        "export async function createExtensionModule() { throw new Error('late factory rejection'); }"
      )
    );
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => {
      unhandled.push(reason);
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        process.on("unhandledRejection", listener);
      }),
      () =>
        Effect.sync(() => {
          process.off("unhandledRejection", listener);
        })
    );
    const source = new NodeInstalledExtensionSource(
      { roots: [root] },
      new NodeInstalledExtensionFileSystem()
    );
    const batch = yield* source.discover();
    yield* rejects(batch.contributions[0]!.load(), "must return an ExtensionModule");
    yield* nativePromise(new Promise<void>((resolve) => setImmediate(resolve)));
    expect(unhandled).toEqual([]);
  })
);

test.effect(
  "installed value and Effect factories share one module validation before activation",
  () =>
    Effect.gen(function* () {
      const root = yield* nativePromise(directory());
      const marker = join(root, "activate-reads");
      yield* nativePromise(
        install(
          root,
          "value-factory",
          packageDeclaration("value-factory"),
          `import { Effect, Layer } from "effect";
        import { appendFileSync } from "node:fs";
        export function createExtensionModule() { return {
          get activate() { appendFileSync(${JSON.stringify(marker)}, "read\\n"); return () => Effect.void; },
          layer: Layer.empty,
          get then() { throw new Error("must not read module then"); }
        }; }`
        )
      );
      yield* nativePromise(
        install(
          root,
          "effect-factory",
          packageDeclaration("effect-factory"),
          'import { Effect } from "effect"; export function createExtensionModule() { return Effect.succeed({ activate: () => Effect.void }); }'
        )
      );
      yield* nativePromise(
        install(
          root,
          "invalid-module",
          packageDeclaration("invalid-module"),
          "export function createExtensionModule() { return { activate: 7 }; }"
        )
      );
      yield* nativePromise(
        install(
          root,
          "promise-activation",
          packageDeclaration("promise-activation"),
          "export function createExtensionModule() { return { activate: async () => { throw new Error('late activation rejection'); } }; }"
        )
      );
      yield* nativePromise(
        install(
          root,
          "promise-effect-value",
          packageDeclaration("promise-effect-value"),
          'import { Effect } from "effect"; export function createExtensionModule() { return Effect.sync(() => Promise.reject(new Error("late module rejection"))); }'
        )
      );
      const source = new NodeInstalledExtensionSource(
        { roots: [root] },
        new NodeInstalledExtensionFileSystem()
      );
      const services = yield* Layer.build(provideInfrastructure({}, [source]));
      yield* Context.get(services, EXTENSION_LIFECYCLE).prepared;
      const activation = Context.get(services, EXTENSION_ACTIVATION);
      for (const id of ["value-factory", "effect-factory"]) {
        expect((yield* activation.activate(id)).status).toBe(ActivationStatus.Active);
      }
      expect(yield* nativePromise(readFile(marker, "utf8"))).toBe("read\n");
      const invalid = yield* activation.activate("invalid-module");
      expect(invalid.status).toBe(ActivationStatus.Failed);
      expect(invalid.phase).toBe(LifecyclePhase.Load);
      expect(invalid.reason).toContain("has no Effect activate function");
      const invalidActivation = yield* activation.activate("promise-activation");
      expect(invalidActivation.status).toBe(ActivationStatus.Failed);
      expect(invalidActivation.phase).toBe(LifecyclePhase.Activation);
      expect(invalidActivation.reason).toContain("activation must return an Effect");
      const invalidEffectValue = yield* activation.activate("promise-effect-value");
      expect(invalidEffectValue.status).toBe(ActivationStatus.Failed);
      expect(invalidEffectValue.phase).toBe(LifecyclePhase.Load);
      yield* nativePromise(new Promise<void>((resolve) => setImmediate(resolve)));
    })
);
