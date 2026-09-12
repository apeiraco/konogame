import assert from "node:assert/strict";
import { jsonSchemaToType } from "@ark/json-schema";
import { v7 as uuidv7 } from "uuid";
import { test } from "vitest";
import { records } from "../../../tests/support/records.ts";
import {
  assertConfigurationRecord,
  assertSettings,
  encodeUniformName,
  HistoryMode,
  recordFileKey,
  recordSchema,
  resolveSettings,
  validateRelationships,
  WORKSPACE_SCHEMA,
  WorkspaceConflictError,
  WorkspaceConflictKind,
  workspaceJsonSchema
} from "../../index.ts";

test("strict schema requires lowercase UUIDv7, uniform names, explicit history mode and JSON values", () => {
  const f = records();
  for (const record of [
    { ...f.game, id: f.game.id.toUpperCase() },
    { ...f.game, id: `${f.game.id.slice(0, 14)}4${f.game.id.slice(15)}` },
    { ...f.game, schemaVersion: "workspace.experimental.2" },
    { ...f.game, uniformName: undefined },
    { ...f.game, typo: true },
    { ...f.game, settings: { typo: true } },
    { ...f.workspace, history: { adapterId: null } },
    { ...f.host, sources: [{ ...f.host.sources[0], roots: [] }] }
  ]) {
    assert.throws(() => recordSchema.assert(record));
  }
  for (const value of [null, { nested: null }, Infinity, 9007199254740992]) {
    assert.throws(() =>
      recordSchema.assert({ ...f.game, settings: { adapterOptions: { example: { value } } } })
    );
  }
  assert.equal(
    recordSchema.assert({
      ...f.workspace,
      history: { mode: HistoryMode.Adapter, adapterId: "example" }
    }).schemaVersion,
    WORKSPACE_SCHEMA
  );
  assert.equal(
    (workspaceJsonSchema() as { $schema: string }).$schema,
    "https://json-schema.org/draft/2020-12/schema"
  );
  assert.throws(() =>
    assertConfigurationRecord({ ...f.workspace, history: { mode: HistoryMode.Adapter } })
  );
  assert.throws(() =>
    assertConfigurationRecord({
      ...f.workspace,
      history: { mode: HistoryMode.Disabled, adapterId: "history" }
    })
  );
});

test("clear directives preserve inheritance, origins, array replacement and opaque options", () => {
  const result = resolveSettings([
    {
      name: "low",
      settings: {
        launchEntry: "play",
        preferredAdapters: { "save.store": "low", "save.history": "history" },
        arguments: ["old"],
        adapterOptions: { example: { a: 1, b: 2 }, other: { value: true } }
      }
    },
    {
      name: "high",
      settings: {
        clear: { launchEntry: true, preferredAdapters: ["save.store"], adapterOptions: ["other"] },
        arguments: [],
        adapterOptions: { example: { a: 3 } }
      }
    }
  ]);
  assert.deepEqual(result.values, {
    launchEntry: null,
    arguments: [],
    preferredAdapters: { "save.store": null, "save.history": "history" },
    adapterOptions: { example: { a: 3 }, other: null }
  });
  assert.equal(result.origins["preferredAdapters.save.store"], "high");
  assert.equal(result.origins["preferredAdapters.save.history"], "low");
  for (const settings of [
    { launchEntry: "play", clear: { launchEntry: true } },
    { preferredAdapters: { x: "y" }, clear: { preferredAdapters: ["x"] } },
    { adapterOptions: { x: {} }, clear: { adapterOptions: ["x"] } },
    { launchEntry: null },
    { preferredAdapters: { x: null } }
  ]) {
    assert.throws(() => assertSettings(settings));
  }
});

test("exported Workspace schema matches the implementation structural constraints", () => {
  const exported = workspaceJsonSchema();
  const text = JSON.stringify(exported);
  assert.equal(text.includes("predicate"), false);
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    nodes.push(value as Record<string, unknown>);
    for (const item of Object.values(value)) {
      visit(item);
    }
  };
  visit(exported);
  const version = nodes.find(
    (node) =>
      node.type === "string" &&
      typeof node.pattern === "string" &&
      new RegExp(node.pattern).test("1.0.0+synthetic") &&
      !new RegExp(node.pattern).test("1.0")
  );
  const number = nodes.find((node) => node.type === "number" && "minimum" in node);
  assert.ok(version);
  assert.ok(number);
  const compiledVersion = jsonSchemaToType({
    type: "string",
    pattern: String(version.pattern)
  });
  const compiledNumber = jsonSchemaToType({
    type: "number",
    minimum: Number(number.minimum),
    maximum: Number(number.maximum)
  });
  for (const schemaVersion of ["1.0.0+synthetic", "1.2.3-rc.1+build.001", "0.0.0+0001.A-b"]) {
    assert.equal(compiledVersion(schemaVersion), schemaVersion);
  }
  for (const schemaVersion of [
    "v1.0.0+synthetic",
    "1.0",
    "01.0.0",
    "1.0.0-01+synthetic",
    "1.0.0+"
  ]) {
    assert.notEqual(compiledVersion(schemaVersion), schemaVersion);
  }
  assert.equal(compiledNumber(1.5), 1.5);
  assert.notEqual(compiledNumber(Number.MAX_SAFE_INTEGER + 1), Number.MAX_SAFE_INTEGER + 1);
  const f = records();
  assert.throws(() => recordSchema.assert({ ...f.game, typo: true }));
  assert.throws(() => recordSchema.assert({ ...f.game, id: "not-a-uuid" }));
  assert.throws(() =>
    recordSchema.assert({
      ...f.installation,
      location: { ...f.installation.location, schemaVersion: "1.0" }
    })
  );
});

test("filename codec normalizes only projection and rejects long encoded components", () => {
  const id = uuidv7();
  assert.equal(
    encodeUniformName('Cafe\u0301 %<>:"/\\|?* .'),
    "Café %25%3C%3E%3A%22%2F%5C%7C%3F%2A%20%2E"
  );
  assert.equal(encodeUniformName("\u0000\u007f\u0080"), "%00%7F%C2%80");
  assert.equal(recordFileKey(id, "CON"), `${id}-CON`);
  assert.throws(() => recordFileKey(id, "界".repeat(73), ".toml"), /255/);
  assert.throws(() => recordFileKey(id, "%".repeat(80)), /255/);
  assert.throws(() => encodeUniformName("\ud800"));
});

test("Workspace preserves unknown Location envelopes and validates only entity references", () => {
  const f = records();
  const location = {
    type: "vendor.future",
    schemaVersion: "2.3.0",
    data: { opaque: ["resource", 42, true] }
  };
  const installation = { ...f.installation, location };
  assert.deepEqual(recordSchema.assert(installation), installation);
  validateRelationships({
    workspace: f.workspace,
    games: [f.game],
    hosts: [{ ...f.host, roots: { games: "opaque root alias" } }],
    installations: [installation],
    revision: "test"
  });
  for (const invalid of [
    { ...location, schemaVersion: "latest" },
    { ...location, data: null },
    { ...location, data: { unsafe: Number.MAX_SAFE_INTEGER + 1 } },
    { ...location, data: { unsupported: undefined } },
    { kind: "fs.absolute", path: "/old" }
  ]) {
    assert.throws(() => recordSchema.assert({ ...installation, location: invalid }));
  }
  assert.throws(
    () =>
      validateRelationships({
        workspace: f.workspace,
        games: [f.game],
        hosts: [f.host],
        installations: [{ ...installation, gameId: uuidv7() }],
        revision: "test"
      }),
    /Unknown game/
  );
});

test("external identity purposes are portable schema data and duplicate persistent identities are structured conflicts", () => {
  const f = records();
  const identity = { issuer: "synthetic.catalog", purpose: "game" as const, value: "product:42" };
  const game = { ...f.game, externalIdentities: [identity] };
  assert.deepEqual(recordSchema.assert(game), game);
  assert.throws(() => recordSchema.assert({ ...f.installation, externalIdentities: [identity] }));
  const exported = workspaceJsonSchema() as {
    $defs: Record<string, { properties?: Record<string, unknown> }>;
  };
  const gameSchema = Object.values(exported.$defs).find(
    (schema) => schema.properties?.externalRefs && schema.properties.title
  );
  assert.ok(gameSchema?.properties);
  const inlineReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(inlineReferences);
    }
    if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (typeof node.$ref === "string") {
        return inlineReferences(exported.$defs[node.$ref.slice("#/$defs/".length)]);
      }
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [key, inlineReferences(child)])
      );
    }
    return value;
  };
  const portableIdentities = jsonSchemaToType(
    inlineReferences(gameSchema.properties.externalIdentities) as Parameters<
      typeof jsonSchemaToType
    >[0]
  );
  assert.deepEqual(portableIdentities.assert([identity]), [identity]);
  assert.throws(() => portableIdentities.assert([{ ...identity, purpose: "installation" }]));
  const snapshot = {
    workspace: f.workspace,
    games: [game],
    hosts: [f.host],
    installations: [f.installation],
    revision: "one"
  };
  validateRelationships(snapshot);
  const conflictingId = uuidv7();
  assert.throws(
    () => validateRelationships({ ...snapshot, games: [game, { ...game, id: conflictingId }] }),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.deepEqual(error.issue, {
        kind: WorkspaceConflictKind.ExternalIdentity,
        recordIds: [game.id, conflictingId],
        ...identity
      });
      return true;
    }
  );
});
