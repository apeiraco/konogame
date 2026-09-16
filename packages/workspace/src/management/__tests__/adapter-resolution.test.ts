import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  DECLARATION_PROTOCOL_RANGE,
  DECLARATION_PROTOCOL_VERSION
} from "@konogame/infrastructure/contracts";
import {
  type ConfigurationHistoryPort,
  HistoryAvailability,
  HistoryMode,
  RecordKind,
  WORKSPACE_SCHEMA,
  WorkspaceCapability,
  type WorkspaceConfigurationPort,
  WorkspaceFeature,
  WorkspaceOperation,
  WorkspacePort,
  type WorkspaceSnapshot,
  workspaceModule
} from "@konogame/workspace";
import { WORKSPACE_CONFIGURATION_PORT } from "@konogame/workspace/contracts";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { assertFailure } from "../../../../../tests/support/assertions.ts";
import { createApplication } from "../../../../../tests/support/use-cases.ts";

const configurationAdapter: AdapterDescriptor = {
  id: "fixture.configuration",
  owner: { kind: AdapterOwnerKind.Extension, id: "fixture.workspace" },
  port: WorkspacePort.Configuration,
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  portVersionRange: WORKSPACE_CONFIGURATION_PORT.supportedRange,
  operations: [
    WorkspaceOperation.Read,
    WorkspaceOperation.Initialize,
    WorkspaceOperation.RecoverInitialize,
    WorkspaceOperation.Edit,
    WorkspaceOperation.RecoverEdit,
    WorkspaceOperation.Rename,
    WorkspaceOperation.Import,
    WorkspaceOperation.RecoverImport
  ],
  capabilities: [
    WorkspaceCapability.Records,
    WorkspaceCapability.Initialize,
    WorkspaceCapability.InitializeRecovery,
    WorkspaceCapability.Edit,
    WorkspaceCapability.EditRecovery,
    WorkspaceCapability.Rename,
    WorkspaceCapability.Import,
    WorkspaceCapability.ImportRecovery
  ]
};

function snapshot(): WorkspaceSnapshot {
  return {
    workspace: {
      kind: RecordKind.Workspace,
      schemaVersion: WORKSPACE_SCHEMA,
      id: uuidv7(),
      name: "Synthetic Adapter resolution fixture",
      defaults: {},
      history: { mode: HistoryMode.Disabled }
    },
    games: [],
    hosts: [],
    installations: [],
    revision: "synthetic-revision"
  };
}
it.effect("Workspace uses the same Extension descriptors and Feature resolution as Save", () =>
  Effect.gen(function* () {
    const app = yield* createApplication(
      [workspaceModule],
      [configurationAdapter],
      new Map(),
      new Map([
        [
          configurationAdapter.id,
          {
            read: () =>
              Effect.sync(() => {
                return snapshot();
              }),
            initialize: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              }),
            recoverInitialize: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              }),
            edit: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              }),
            recoverEdit: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              }),
            rename: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              }),
            import: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              }),
            recoverImport: () =>
              Effect.gen(function* () {
                return yield* Effect.die(new Error("unused"));
              })
          }
        ]
      ])
    );
    assert.deepEqual(yield* app.plan.features(), [
      WorkspaceFeature.Initialize,
      WorkspaceFeature.RecoverInitialize,
      WorkspaceFeature.Edit,
      WorkspaceFeature.RecoverEdit,
      WorkspaceFeature.Inspect,
      WorkspaceFeature.Rename,
      WorkspaceFeature.Import,
      WorkspaceFeature.RecoverImport,
      WorkspaceFeature.History,
      WorkspaceFeature.Browse,
      WorkspaceFeature.Probe
    ]);
    const plan = yield* app.plan.plan(yield* app.plan.features());
    assert.equal(plan.resolvedAdapters[0]?.adapterId, configurationAdapter.id);
    assert.deepEqual(plan.resolvedAdapters[0]?.owner, configurationAdapter.owner);
    assert.ok(plan.unavailable.some((item) => item.feature === WorkspaceFeature.History));
  })
);
it.effect(
  "Workspace rejects incompatible declaration protocol, operation, capability or preference before reading",
  () =>
    Effect.gen(function* () {
      let reads = 0;
      const port: WorkspaceConfigurationPort = {
        read() {
          return Effect.sync(() => {
            reads++;
            return snapshot();
          });
        }
      };
      const base = {
        ...configurationAdapter,
        operations: [WorkspaceOperation.Read],
        capabilities: [WorkspaceCapability.Records]
      };
      for (const descriptor of [
        { ...base, declarationProtocolRange: "2.0.0" },
        { ...base, operations: [] },
        { ...base, capabilities: [] }
      ]) {
        const app = yield* createApplication(
          [workspaceModule],
          [descriptor],
          new Map(),
          new Map([[base.id, port]])
        );
        yield* assertFailure(app.workspace.inspectWorkspace("unused"), /No adapter satisfies/);
      }
      const app = yield* createApplication(
        [workspaceModule],
        [base],
        new Map(),
        new Map([[base.id, port]])
      );
      for (const preferredAdapterId of ["absent", ""]) {
        yield* assertFailure(
          app.workspace.inspectWorkspace("unused", { preferredAdapterId }),
          /No compatible adapter matches preference/
        );
      }
      assert.equal(reads, 0);
      const inactive = yield* createApplication([workspaceModule], [base]);
      yield* assertFailure(
        inactive.workspace.inspectWorkspace("unused"),
        /no active implementation/
      );
    })
);
it.effect(
  "explicit bootstrap preference selects the resolved implementation and receives the root",
  () =>
    Effect.gen(function* () {
      const base = {
        ...configurationAdapter,
        operations: [WorkspaceOperation.Read],
        capabilities: [WorkspaceCapability.Records]
      };
      const alternate: AdapterDescriptor = {
        ...base,
        id: "fixture.alternate",
        owner: { kind: "extension", id: "fixture" },
        priority: -10
      };
      const calls: string[] = [];
      const data = snapshot();
      data.workspace.defaults.preferredAdapters = {
        [WorkspaceFeature.Inspect]: "must-not-rebind-after-loading"
      };
      const implementations = new Map<string, WorkspaceConfigurationPort>([
        [
          base.id,
          {
            read() {
              return Effect.sync(() => {
                calls.push(base.id);
                return data;
              });
            }
          }
        ],
        [
          alternate.id,
          {
            read({ root }) {
              return Effect.sync(() => {
                calls.push(root);
                return data;
              });
            }
          }
        ]
      ]);
      const app = yield* createApplication(
        [workspaceModule],
        [base, alternate],
        new Map(),
        implementations
      );
      const result = yield* app.workspace.inspectWorkspace("selected-root", {
        preferredAdapterId: alternate.id
      });
      assert.equal(result.adapterResolutionPlan.resolvedAdapters[0]?.adapterId, alternate.id);
      assert.deepEqual(calls, ["selected-root"]);
    })
);
it.effect("history availability comes from the shared resolver and an active implementation", () =>
  Effect.gen(function* () {
    const data = snapshot();
    const config = {
      ...configurationAdapter,
      operations: [WorkspaceOperation.Read],
      capabilities: [WorkspaceCapability.Records]
    };
    const history: AdapterDescriptor = {
      id: "fixture.history",
      owner: { kind: "extension", id: "fixture" },
      port: WorkspacePort.History,
      declarationProtocolRange: DECLARATION_PROTOCOL_VERSION,
      portVersionRange: "^0.2.0",
      operations: [WorkspaceOperation.List],
      capabilities: [WorkspaceCapability.VersionedHistory]
    };
    let historyCalls = 0;
    const unused = () =>
      Effect.gen(function* () {
        historyCalls++;
        return yield* Effect.die(new Error("Inspection must not execute history operations"));
      });
    const historyPort: ConfigurationHistoryPort = {
      list: unused,
      read: unused,
      record: unused,
      findOperation: unused
    };
    const configurations = new Map([
      [
        config.id,
        {
          read() {
            return Effect.sync(() => {
              return data;
            });
          }
        }
      ]
    ]);
    const create = (
      descriptor: AdapterDescriptor,
      histories = new Map<string, ConfigurationHistoryPort>()
    ) =>
      createApplication(
        [workspaceModule],
        [config, descriptor],
        new Map(),
        configurations,
        histories
      );
    const active = new Map([[history.id, historyPort]]);
    assert.equal(
      (yield* (yield* create(history, active)).workspace.inspectWorkspace("unused")).history.status,
      HistoryAvailability.Disabled
    );
    data.workspace.history = { mode: HistoryMode.Adapter, adapterId: history.id };
    assert.equal(
      (yield* (yield* create(history)).workspace.inspectWorkspace("unused")).history.status,
      HistoryAvailability.Unavailable
    );
    const available = yield* (yield* create(history, active)).workspace.inspectWorkspace("unused");
    assert.equal(available.history.status, HistoryAvailability.Available);
    assert.equal(
      available.history.adapterResolutionPlan.resolvedAdapters[0]?.adapterId,
      history.id
    );
    for (const incompatible of [
      { ...history, operations: [] },
      { ...history, capabilities: [] },
      { ...history, declarationProtocolRange: "2.0.0" }
    ]) {
      assert.equal(
        (yield* (yield* create(incompatible, active)).workspace.inspectWorkspace("unused")).history
          .adapterResolutionPlan.unavailable.length,
        1
      );
    }
    data.workspace.history = { mode: HistoryMode.Adapter, adapterId: "missing-explicit-history" };
    assert.equal(
      (yield* (yield* create(history, active)).workspace.inspectWorkspace("unused")).history.status,
      HistoryAvailability.Unavailable
    );
    assert.equal(historyCalls, 0);
  })
);
