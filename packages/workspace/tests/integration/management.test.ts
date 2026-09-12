import assert from "node:assert/strict";
import { resolve } from "node:path";
import { it } from "@effect/vitest";
import {
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind
} from "@konogame/infrastructure";
import { type AdapterDescriptor, SchemaValidationError } from "@konogame/infrastructure/contracts";
import {
  WORKSPACE_SCHEMA,
  type WorkspaceConfigurationPort,
  type WorkspaceSnapshot,
  workspaceModule
} from "@konogame/workspace";
import {
  WorkspaceMismatchKind,
  WorkspaceReviewMismatchError
} from "@konogame/workspace/management";
import { Effect } from "effect";
import { expect } from "vitest";
import { createApplication } from "../../../../tests/support/use-cases.ts";

const workspaceId = "019a0000-0000-7000-8000-000000000001";
const descriptor: AdapterDescriptor = {
  id: "fixture.configuration",
  owner: { kind: "module", id: "konogame.workspace" },
  port: "workspace.configuration",
  declarationProtocolRange: "^0.2.0",
  portVersionRange: "^0.2.0",
  operations: ["read", "edit"],
  capabilities: ["configuration.records", "configuration.edit"]
};
const change = {
  kind: "metadata.replace" as const,
  target: { kind: "workspace" as const, recordId: workspaceId },
  metadata: { name: "Edited" }
};
function fixture(readonly = false) {
  return Effect.gen(function* () {
    const snapshot: WorkspaceSnapshot = {
      workspace: {
        kind: "workspace",
        schemaVersion: WORKSPACE_SCHEMA,
        id: workspaceId,
        name: "Original",
        defaults: {},
        history: { mode: "disabled" }
      },
      games: [],
      hosts: [],
      installations: [],
      revision: "revision"
    };
    let writes = 0;
    const configuration: WorkspaceConfigurationPort = {
      read() {
        return Effect.sync(() => {
          return structuredClone(snapshot);
        });
      },
      ...(!readonly
        ? {
            edit(input: Parameters<NonNullable<WorkspaceConfigurationPort["edit"]>>[0]) {
              return Effect.sync(() => {
                writes++;
                return { status: "edited" as const, operationId: input.operationId };
              });
            }
          }
        : {})
    };
    const app = yield* createApplication(
      [workspaceModule],
      [
        readonly
          ? { ...descriptor, operations: ["read"], capabilities: ["configuration.records"] }
          : descriptor
      ],
      new Map(),
      new Map([[descriptor.id, configuration]])
    );
    return { app, snapshot, writes: () => writes };
  });
}
it.effect(
  "read-only configuration previews metadata and reports apply capability without writes or Location behavior",
  () =>
    Effect.gen(function* () {
      const { app, writes } = yield* fixture(true);
      const preview = yield* app.workspace.preview({ root: "synthetic", change });
      expect(preview.differences).toEqual([{ field: "name", before: "Original", after: "Edited" }]);
      expect(preview.applyAdapterResolutionPlan.unavailable).toHaveLength(1);
      const error = yield* Effect.flip(app.workspace.apply({ root: "synthetic", preview }));
      assert.ok(error instanceof AdapterResolutionUnavailableError);
      assert.equal(error.issue.kind, AdapterResolutionUnavailableKind.Resolution);
      if (error.issue.kind === AdapterResolutionUnavailableKind.Resolution) {
        assert.equal(error.issue.featureId, "workspace.edit");
      }
      expect(writes()).toBe(0);
    })
);
it.effect(
  "apply rejects a different root, stale revisions, malformed or tampered previews before writing",
  () =>
    Effect.gen(function* () {
      const { app, snapshot, writes } = yield* fixture();
      const preview = yield* app.workspace.preview({ root: "synthetic", change });
      const rootError = yield* Effect.flip(app.workspace.apply({ root: "another", preview }));
      assert.ok(rootError instanceof WorkspaceReviewMismatchError);
      assert.deepEqual(rootError.issue, {
        reviewKind: "workspace-edit",
        kind: WorkspaceMismatchKind.Root,
        expected: preview.root,
        actual: resolve("another")
      });
      assert.match(rootError.message, /root does not match/);
      const schemaError = yield* Effect.flip(
        app.workspace.apply({ root: "synthetic", preview: { ...preview, arbitrary: true } })
      );
      assert.ok(schemaError instanceof SchemaValidationError);
      assert.equal(schemaError.schemaId, "application.workspace-edit-preview");
      assert.ok(schemaError.issues.some((issue) => issue.path.includes("arbitrary")));
      const digestError = yield* Effect.flip(
        app.workspace.apply({
          root: "synthetic",
          preview: { ...preview, change: { ...change, metadata: { name: "Tampered" } } }
        })
      );
      assert.ok(digestError instanceof WorkspaceReviewMismatchError);
      assert.equal(digestError.issue.kind, WorkspaceMismatchKind.Digest);
      assert.equal(digestError.issue.expected, preview.digest);
      assert.notEqual(digestError.issue.actual, preview.digest);
      assert.match(digestError.message, /digest/);
      snapshot.revision = "changed";
      const staleError = yield* Effect.flip(app.workspace.apply({ root: "synthetic", preview }));
      assert.ok(staleError instanceof WorkspaceReviewMismatchError);
      assert.equal(staleError.issue.kind, WorkspaceMismatchKind.Stale);
      assert.equal(staleError.issue.expectedRevision, "revision");
      assert.equal(staleError.issue.actualRevision, "changed");
      assert.match(staleError.message, /stale/);
      expect(writes()).toBe(0);
      const fresh = yield* app.workspace.preview({ root: "synthetic", change });
      expect((yield* app.workspace.apply({ root: "synthetic", preview: fresh })).status).toBe(
        "edited"
      );
      expect(writes()).toBe(1);
    })
);
