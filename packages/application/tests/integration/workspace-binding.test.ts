import assert from "node:assert/strict";
import { KonogameApplication } from "@konogame/application";
import { type AdapterDescriptor, CONTRACT_VERSION } from "@konogame/contracts";
import {
  filesystemExtension,
  filesystemWorkspaceConfigurationAdapter
} from "@konogame/extension-filesystem";
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
import { v7 as uuidv7 } from "uuid";
import { test } from "vitest";

function snapshot(): WorkspaceSnapshot {
  return {
    workspace: {
      kind: RecordKind.Workspace,
      schemaVersion: WORKSPACE_SCHEMA,
      id: uuidv7(),
      name: "Synthetic binding fixture",
      defaults: {},
      history: { mode: HistoryMode.Disabled }
    },
    games: [],
    hosts: [],
    installations: [],
    revision: "synthetic-revision"
  };
}

test("Workspace uses the same Extension descriptors and Feature binding as Save", () => {
  const app = new KonogameApplication([workspaceModule], filesystemExtension.adapters);
  assert.deepEqual(app.features(), [
    WorkspaceFeature.Inspect,
    WorkspaceFeature.Rename,
    WorkspaceFeature.History
  ]);
  const plan = app.plan(app.features());
  assert.equal(plan.bindings[0]?.adapterId, filesystemWorkspaceConfigurationAdapter.id);
  assert.equal(plan.bindings[0]?.extensionId, filesystemExtension.id);
  assert.equal(plan.unavailable[0]?.feature, WorkspaceFeature.History);
});

test("Workspace rejects incompatible contract, operation, capability or preference before reading", async () => {
  let reads = 0;
  const port: WorkspaceConfigurationPort = {
    async read() {
      reads++;
      return snapshot();
    }
  };
  const base = filesystemWorkspaceConfigurationAdapter;
  for (const descriptor of [
    { ...base, contractRange: "incompatible" },
    { ...base, operations: [] },
    { ...base, capabilities: [] },
    { ...base, port: WorkspacePort.History }
  ]) {
    const app = new KonogameApplication(
      [workspaceModule],
      [descriptor],
      new Map(),
      new Map([[base.id, port]])
    );
    await assert.rejects(() => app.inspectWorkspace("unused"), /No adapter satisfies/);
  }
  const app = new KonogameApplication(
    [workspaceModule],
    [base],
    new Map(),
    new Map([[base.id, port]])
  );
  for (const preferredAdapterId of ["absent", ""]) {
    await assert.rejects(
      () => app.inspectWorkspace("unused", { preferredAdapterId }),
      /No compatible adapter matches preference/
    );
  }
  assert.equal(reads, 0);
  const inactive = new KonogameApplication([workspaceModule], [base]);
  await assert.rejects(() => inactive.inspectWorkspace("unused"), /no active implementation/);
});

test("explicit bootstrap preference selects the bound implementation and receives the root", async () => {
  const base = filesystemWorkspaceConfigurationAdapter;
  const alternate = { ...base, id: "fixture.alternate", extensionId: "fixture", priority: -10 };
  const calls: string[] = [];
  const data = snapshot();
  data.workspace.defaults.preferredAdapters = {
    [WorkspaceFeature.Inspect]: "must-not-rebind-after-loading"
  };
  const implementations = new Map<string, WorkspaceConfigurationPort>([
    [
      base.id,
      {
        async read() {
          calls.push(base.id);
          return data;
        }
      }
    ],
    [
      alternate.id,
      {
        async read({ root }) {
          calls.push(root);
          return data;
        }
      }
    ]
  ]);
  const app = new KonogameApplication(
    [workspaceModule],
    [base, alternate],
    new Map(),
    implementations
  );
  const result = await app.inspectWorkspace("selected-root", { preferredAdapterId: alternate.id });
  assert.equal(result.bindingPlan.bindings[0]?.adapterId, alternate.id);
  assert.deepEqual(calls, ["selected-root"]);
});

test("history availability comes from the shared resolver and an active implementation", async () => {
  const data = snapshot();
  const config = filesystemWorkspaceConfigurationAdapter;
  const history: AdapterDescriptor = {
    id: "fixture.history",
    extensionId: "fixture",
    port: WorkspacePort.History,
    contractRange: CONTRACT_VERSION,
    operations: [WorkspaceOperation.List],
    capabilities: [WorkspaceCapability.VersionedHistory]
  };
  let historyCalls = 0;
  const unused = async (): Promise<never> => {
    historyCalls++;
    throw new Error("Inspection must not execute history operations");
  };
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
        async read() {
          return data;
        }
      }
    ]
  ]);
  const create = (
    descriptor: AdapterDescriptor,
    histories = new Map<string, ConfigurationHistoryPort>()
  ) =>
    new KonogameApplication(
      [workspaceModule],
      [config, descriptor],
      new Map(),
      configurations,
      histories
    );
  const active = new Map([[history.id, historyPort]]);
  assert.equal(
    (await create(history, active).inspectWorkspace("unused")).history.status,
    HistoryAvailability.Disabled
  );
  data.workspace.history = { mode: HistoryMode.Adapter, adapterId: history.id };
  assert.equal(
    (await create(history).inspectWorkspace("unused")).history.status,
    HistoryAvailability.Unavailable
  );
  const available = await create(history, active).inspectWorkspace("unused");
  assert.equal(available.history.status, HistoryAvailability.Available);
  assert.equal(available.history.bindingPlan.bindings[0]?.adapterId, history.id);
  for (const incompatible of [
    { ...history, operations: [] },
    { ...history, capabilities: [] },
    { ...history, contractRange: "incompatible" }
  ]) {
    assert.equal(
      (await create(incompatible, active).inspectWorkspace("unused")).history.bindingPlan
        .unavailable.length,
      1
    );
  }
  data.workspace.history = { mode: HistoryMode.Adapter, adapterId: "missing-explicit-history" };
  assert.equal(
    (await create(history, active).inspectWorkspace("unused")).history.status,
    HistoryAvailability.Unavailable
  );
  assert.equal(historyCalls, 0);
});
