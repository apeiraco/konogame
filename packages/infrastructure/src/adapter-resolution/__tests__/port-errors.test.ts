import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { WorkspaceFileSystemError } from "@konogame/extension-workspace-toml";
import {
  ADAPTER_RESOLVER,
  AdapterResolutionUnavailableKind,
  defineExtensionModule,
  ExtensionNotFoundError,
  FeatureNotFoundError,
  InfrastructureError,
  LifecyclePhase
} from "@konogame/infrastructure";
import {
  type AdapterDescriptor,
  DECLARATION_PROTOCOL_RANGE
} from "@konogame/infrastructure/contracts";
import { SaveError, type SaveStorePort, saveModule } from "@konogame/save";
import { type SaveStoreWorkflow } from "@konogame/save/store";
import {
  WORKSPACE_SCHEMA,
  type WorkspaceConfigurationError,
  type WorkspaceConfigurationPort,
  type WorkspaceSnapshot,
  workspaceConfigurationImplementation,
  workspaceModule
} from "@konogame/workspace";
import { type WorkspaceManagementService } from "@konogame/workspace/management";
import { Cause, Context, Effect, Exit, Stream } from "effect";
import { expectTypeOf, vi } from "vitest";
import {
  createApplication,
  createApplicationContext,
  useCases
} from "../../../../../tests/support/use-cases.ts";

afterEach(() => {
  vi.restoreAllMocks();
});
const storeDescriptor: AdapterDescriptor = {
  id: "synthetic.store",
  owner: { kind: "extension", id: "synthetic.store" },
  port: "save.store",
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  portVersionRange: "^0.2.0",
  operations: ["put", "open"],
  capabilities: ["artifact.multifile", "artifact.streaming"]
};
const configurationDescriptor: AdapterDescriptor = {
  id: "synthetic.configuration",
  owner: { kind: "module", id: "konogame.workspace" },
  port: "workspace.configuration",
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  portVersionRange: "^0.2.0",
  operations: ["read"],
  capabilities: ["configuration.records"]
};

it("public workflows retain concrete Port error types", () => {
  expectTypeOf<Effect.Error<ReturnType<SaveStoreWorkflow["storeSave"]>>>()
    .extract<SaveError>()
    .toEqualTypeOf<SaveError>();
  expectTypeOf<Effect.Error<ReturnType<WorkspaceManagementService["inspectWorkspace"]>>>()
    .extract<WorkspaceConfigurationError>()
    .toEqualTypeOf<WorkspaceConfigurationError>();
});

it.effect("Feature and Extension lookups are caught through the application owner tag", () =>
  Effect.gen(function* () {
    const app = yield* createApplication([saveModule], []);
    const missing = yield* app.plan
      .plan(["missing.feature"])
      .pipe(Effect.catchTag("FeatureNotFoundError", (error) => Effect.succeed(error)));
    assert.ok(missing instanceof FeatureNotFoundError);
    assert.deepEqual(missing.issue, {
      kind: "feature",
      id: "missing.feature"
    });
    const extension = yield* app.catalog
      .status("missing.extension")
      .pipe(Effect.catchTag("ExtensionNotFoundError", (error) => Effect.succeed(error)));
    assert.ok(extension instanceof ExtensionNotFoundError);
    assert.deepEqual(extension.issue, {
      kind: "extension",
      id: "missing.extension"
    });
  })
);

it.effect(
  "unavailable save Adapter resolutions expose the requested Feature instead of an unclassified cause",
  () =>
    Effect.gen(function* () {
      const app = yield* createApplication([saveModule], []);
      const result = yield* app.save
        .storeSave({ mediaType: "application/test", files: Stream.empty })
        .pipe(
          Effect.catchTag("AdapterResolutionUnavailableError", (error) =>
            Effect.succeed(error.issue)
          )
        );
      assert.ok("kind" in result);
      assert.equal(result.kind, AdapterResolutionUnavailableKind.Resolution);
      if (result.kind === AdapterResolutionUnavailableKind.Resolution) {
        assert.equal(result.featureId, "save.store");
      }
    })
);

it.effect("a real store Port failure retains its owner error and original I/O cause", () =>
  Effect.gen(function* () {
    const native = Object.assign(new Error("Device unavailable"), { code: "EIO" });
    const original = new SaveError({ operation: "put", cause: native, message: native.message });
    const store: SaveStorePort = {
      put: () => Effect.fail(original),
      open: () => Effect.die("Unused")
    };
    const app = yield* createApplication(
      [saveModule],
      [storeDescriptor],
      new Map([[storeDescriptor.id, store]])
    );
    const error = yield* app.save
      .storeSave({ mediaType: "application/test", files: Stream.empty })
      .pipe(Effect.catchTag("SaveError", (error) => Effect.succeed(error)));
    assert.equal(error, original);
    assert.equal(original.cause, native);
  })
);

it.effect("configuration Port I/O is not turned into an explain availability result", () =>
  Effect.gen(function* () {
    const native = Object.assign(new Error("Read denied"), { code: "EACCES" });
    const original = new WorkspaceFileSystemError({
      operation: "read",
      code: "EACCES",
      cause: native,
      message: native.message
    });
    const configuration: WorkspaceConfigurationPort = { read: () => Effect.fail(original) };
    const app = yield* createApplication(
      [workspaceModule],
      [configurationDescriptor],
      new Map(),
      new Map([[configurationDescriptor.id, configuration]])
    );
    const error = yield* app.workspace
      .explainSettings("synthetic")
      .pipe(Effect.catchTag("WorkspaceFileSystemError", (error) => Effect.succeed(error)));
    assert.equal(error, original);
    assert.equal(original.cause, native);
  })
);

it.effect("a trusted pure planning bug escapes the workflow as a defect", () =>
  Effect.gen(function* () {
    const context = yield* createApplicationContext([
      {
        kind: "module",
        manifest: saveModule,
        load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
      }
    ]);
    const app = useCases(context);
    const adapterResolver = Context.get(context, ADAPTER_RESOLVER);
    const defect = new TypeError("Broken trusted feature projection");
    vi.spyOn(adapterResolver, "features").mockImplementation(() => {
      throw defect;
    });
    const exit = yield* Effect.exit(app.plan.plan(["save.store"]));
    assert.ok(Exit.isFailure(exit));
    assert.equal(Cause.hasFails(exit.cause), false);
    assert.equal(exit.cause.reasons.filter(Cause.isDieReason)[0]?.defect, defect);
  })
);

it.effect(
  "explain only downgrades missing Features and preserves Core failures inside Adapter resolution planning",
  () =>
    Effect.gen(function* () {
      const snapshot: WorkspaceSnapshot = {
        workspace: {
          schemaVersion: WORKSPACE_SCHEMA,
          kind: "workspace",
          id: "019a0000-0000-7000-8000-000000000001",
          name: "Synthetic",
          defaults: {},
          history: { mode: "disabled" }
        },
        hosts: [],
        games: [],
        installations: [],
        revision: "revision"
      };
      const context = yield* createApplicationContext([
        {
          kind: "module",
          manifest: { ...workspaceModule, contributes: { adapters: [configurationDescriptor] } },
          load: () =>
            Effect.succeed(
              defineExtensionModule({
                activate: (context) =>
                  context.registerAdapter(
                    configurationDescriptor.id,
                    workspaceConfigurationImplementation,
                    { read: () => Effect.succeed(snapshot) }
                  )
              })
            )
        },
        {
          kind: "module",
          manifest: saveModule,
          load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
        }
      ]);
      const app = useCases(context);
      const adapterResolver = Context.get(context, ADAPTER_RESOLVER);
      const originalResolve = adapterResolver.resolve.bind(adapterResolver);
      const original = new InfrastructureError({
        phase: LifecyclePhase.Providers,
        message: "Synthetic Adapter resolution acquisition failure"
      });
      vi.spyOn(adapterResolver, "resolve").mockImplementation((requests) =>
        requests.some((request) => request.feature.id === "save.store")
          ? Effect.fail(original)
          : originalResolve(requests)
      );
      const error = yield* app.workspace
        .explainSettings("synthetic", {}, ["save.store"])
        .pipe(Effect.catchTag("InfrastructureError", (error) => Effect.succeed(error)));
      assert.equal(error, original);
    })
);
