import assert from "node:assert/strict";
import { type AdapterDescriptor, CONTRACT_VERSION } from "@konogame/contracts";
import {
  type RenameConfigurationInput,
  RenameStatus,
  WorkspaceCapability,
  type WorkspaceConfigurationPort,
  WorkspaceFeature,
  WorkspaceOperation,
  WorkspacePort,
  workspaceModule
} from "@konogame/workspace";
import { v7 as uuidv7 } from "uuid";
import { test } from "vitest";
import { KonogameApplication } from "../index.ts";

const descriptor: AdapterDescriptor = {
  id: "synthetic.configuration",
  extensionId: "synthetic",
  port: WorkspacePort.Configuration,
  contractRange: CONTRACT_VERSION,
  operations: [WorkspaceOperation.Rename],
  capabilities: [WorkspaceCapability.Rename]
};
const input = (): RenameConfigurationInput => ({
  root: "synthetic-workspace",
  recordId: uuidv7(),
  uniformName: "名前 🎮",
  expectedRevision: "observation",
  operationId: uuidv7()
});

test("rename binds its operation before dispatch and preserves the adapter result", async () => {
  const request = input();
  const configuration: WorkspaceConfigurationPort = {
    async read() {
      throw new Error("Rename must not dispatch read");
    },
    async rename(received) {
      assert.deepEqual(received, request);
      return {
        status: RenameStatus.Renamed,
        operationId: received.operationId,
        revision: "new-observation"
      };
    }
  };
  const app = new KonogameApplication(
    [workspaceModule],
    [descriptor],
    new Map(),
    new Map([[descriptor.id, configuration]])
  );
  const result = await app.renameWorkspace(request);
  assert.equal(result.status, RenameStatus.Renamed);
  assert.equal(result.bindingPlan.bindings[0]?.feature, WorkspaceFeature.Rename);
  assert.equal(result.bindingPlan.bindings[0]?.adapterId, descriptor.id);
});

test("rename refuses incompatible preferences, missing capability and missing runtime without I/O", async () => {
  let calls = 0;
  const configuration: WorkspaceConfigurationPort = {
    async read() {
      calls++;
      throw new Error("Unexpected I/O");
    },
    async rename(request) {
      calls++;
      return { status: RenameStatus.Unchanged, operationId: request.operationId };
    }
  };
  const make = (adapter: AdapterDescriptor, instance?: WorkspaceConfigurationPort) =>
    new KonogameApplication(
      [workspaceModule],
      [adapter],
      new Map(),
      instance ? new Map([[adapter.id, instance]]) : new Map()
    );
  await assert.rejects(
    () => make(descriptor, configuration).renameWorkspace(input(), "missing"),
    /preference/
  );
  await assert.rejects(
    () => make({ ...descriptor, capabilities: [] }, configuration).renameWorkspace(input()),
    /No adapter/
  );
  await assert.rejects(
    () => make({ ...descriptor, operations: [] }, configuration).renameWorkspace(input()),
    /No adapter/
  );
  await assert.rejects(() => make(descriptor).renameWorkspace(input()), /no active rename/);
  await assert.rejects(
    () => make(descriptor, { read: configuration.read }).renameWorkspace(input()),
    /no active rename/
  );
  assert.equal(calls, 0);
});
