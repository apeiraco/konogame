import assert from "node:assert/strict";
import { SchemaValidationError } from "@konogame/infrastructure/contracts";
import { it } from "vitest";
import { records } from "../../../tests/support/records.ts";
import {
  assertConfigurationRecord,
  assertSettings,
  encodeUniformName,
  SettingsClearField,
  validateRelationships,
  WorkspaceConflictError,
  WorkspaceConflictKind,
  WorkspaceInvalidInputError,
  WorkspaceInvalidInputKind,
  WorkspaceNotFoundError,
  WorkspaceResourceKind,
  type WorkspaceRuleFailure
} from "../../index.ts";

function category(error: WorkspaceRuleFailure): string {
  switch (error._tag) {
    case "SchemaValidationError":
      return error.schemaId;
    case "WorkspaceInvalidInputError":
      return error.issue.kind;
    case "WorkspaceNotFoundError":
      return error.resource;
    case "WorkspaceConflictError":
      return error.issue.kind;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}
it("schema, invalid names and settings conflicts retain independent tags and fields", () => {
  const f = records();
  assert.throws(
    () => assertConfigurationRecord({ ...f.game, title: 1 }),
    (error) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.equal(category(error), "workspace.record");
      return true;
    }
  );
  assert.throws(
    () => encodeUniformName(""),
    (error) => {
      assert.ok(error instanceof WorkspaceInvalidInputError);
      assert.equal(error.issue.kind, WorkspaceInvalidInputKind.UniformName);
      return true;
    }
  );
  assert.throws(
    () => assertSettings({ launchEntry: "main", clear: { launchEntry: true } }),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.deepEqual(error.issue, {
        kind: WorkspaceConflictKind.SettingsSetAndClear,
        field: SettingsClearField.LaunchEntry
      });
      return true;
    }
  );
});
it("relationships identify missing references and duplicate UUIDs", () => {
  const f = records();
  const snapshot = {
    workspace: f.workspace,
    games: [f.game],
    hosts: [f.host],
    installations: [f.installation],
    revision: "fixture"
  };
  assert.throws(
    () => validateRelationships({ ...snapshot, games: [f.game, f.game] }),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.deepEqual(error.issue, {
        kind: WorkspaceConflictKind.DuplicateRecordId,
        recordId: f.game.id
      });
      return true;
    }
  );
  assert.throws(
    () => validateRelationships({ ...snapshot, games: [] }),
    (error) => {
      assert.ok(error instanceof WorkspaceNotFoundError);
      assert.equal(error.resource, WorkspaceResourceKind.Game);
      assert.equal(error.id, f.installation.gameId);
      return true;
    }
  );
});
