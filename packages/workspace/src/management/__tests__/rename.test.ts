import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type AdapterDescriptor,
  DECLARATION_PROTOCOL_VERSION
} from "@konogame/infrastructure/contracts";
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
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { assertFailure } from "../../../../../tests/support/assertions.ts";
import { createApplication } from "../../../../../tests/support/use-cases.ts";

const descriptor: AdapterDescriptor = {
  id: "synthetic.configuration",
  owner: { kind: "extension", id: "synthetic" },
  port: WorkspacePort.Configuration,
  declarationProtocolRange: DECLARATION_PROTOCOL_VERSION,
  portVersionRange: "^0.2.0",
  operations: [WorkspaceOperation.Rename],
  capabilities: [WorkspaceCapability.Rename]
};
const input = (): RenameConfigurationInput => ({
  root: "synthetic-workspace",
  recordId: uuidv7(),
  uniformName: "鍚嶅墠 馃幃",
  expectedRevision: "observation",
  operationId: uuidv7()
});
it.effect("rename binds its operation before dispatch and preserves the adapter result", () =>
  Effect.gen(function* () {
    const request = input();
    const configuration: WorkspaceConfigurationPort = {
      read() {
        return Effect.gen(function* () {
          return yield* Effect.die(new Error("Rename must not dispatch read"));
        });
      },
      rename(received) {
        return Effect.sync(() => {
          assert.deepEqual(received, request);
          return {
            status: RenameStatus.Renamed,
            operationId: received.operationId,
            revision: "new-observation"
          };
        });
      }
    };
    const app = yield* createApplication(
      [workspaceModule],
      [descriptor],
      new Map(),
      new Map([[descriptor.id, configuration]])
    );
    const result = yield* app.workspace.renameWorkspace(request);
    assert.equal(result.status, RenameStatus.Renamed);
    assert.equal(
      result.adapterResolutionPlan.resolvedAdapters[0]?.feature,
      WorkspaceFeature.Rename
    );
    assert.equal(result.adapterResolutionPlan.resolvedAdapters[0]?.adapterId, descriptor.id);
  })
);
it.effect(
  "rename refuses incompatible preferences, missing capability and missing implementation without I/O",
  () =>
    Effect.gen(function* () {
      let calls = 0;
      const configuration: WorkspaceConfigurationPort = {
        read() {
          return Effect.gen(function* () {
            calls++;
            return yield* Effect.die(new Error("Unexpected I/O"));
          });
        },
        rename(request) {
          return Effect.sync(() => {
            calls++;
            return { status: RenameStatus.Unchanged, operationId: request.operationId };
          });
        }
      };
      const make = (adapter: AdapterDescriptor, instance?: WorkspaceConfigurationPort) =>
        createApplication(
          [workspaceModule],
          [adapter],
          new Map(),
          instance ? new Map([[adapter.id, instance]]) : new Map()
        );
      yield* assertFailure(
        (yield* make(descriptor, configuration)).workspace.renameWorkspace(input(), "missing"),
        /preference/
      );
      yield* assertFailure(
        (yield* make({ ...descriptor, capabilities: [] }, configuration)).workspace.renameWorkspace(
          input()
        ),
        /No adapter/
      );
      yield* assertFailure(
        (yield* make({ ...descriptor, operations: [] }, configuration)).workspace.renameWorkspace(
          input()
        ),
        /No adapter/
      );
      yield* assertFailure(
        (yield* make(descriptor)).workspace.renameWorkspace(input()),
        /no active implementation/
      );
      yield* assertFailure(
        (yield* make(descriptor, { read: configuration.read })).workspace.renameWorkspace(input()),
        /no implementation method/
      );
      assert.equal(calls, 0);
    })
);
it.effect("import recovery binds its dedicated operation and passes no arbitrary records", () =>
  Effect.gen(function* () {
    const request = { root: "synthetic-workspace", operationId: uuidv7() };
    let calls = 0;
    const configuration: WorkspaceConfigurationPort = {
      read() {
        return Effect.gen(function* () {
          return yield* Effect.die(new Error("Recovery does not read an incomplete Workspace"));
        });
      },
      recoverImport(received) {
        return Effect.sync(() => {
          calls++;
          assert.deepEqual(received, request);
          return { status: "unchanged" as const, operationId: received.operationId };
        });
      }
    };
    const recoveryDescriptor: AdapterDescriptor = {
      ...descriptor,
      operations: [WorkspaceOperation.RecoverImport],
      capabilities: [WorkspaceCapability.ImportRecovery]
    };
    const app = yield* createApplication(
      [workspaceModule],
      [recoveryDescriptor],
      new Map(),
      new Map([[descriptor.id, configuration]])
    );
    const result = yield* app.workspace.recoverWorkspaceImport(request);
    assert.equal(
      result.adapterResolutionPlan.resolvedAdapters[0]?.feature,
      WorkspaceFeature.RecoverImport
    );
    assert.equal(calls, 1);
    yield* assertFailure(app.workspace.recoverWorkspaceImport(request, "missing"), /preference/);
    assert.equal(calls, 1);
  })
);
