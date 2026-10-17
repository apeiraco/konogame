import assert from "node:assert/strict";
import { v7 as uuidv7 } from "uuid";
import { test } from "vitest";
import { records } from "../../tests/support/records.ts";
import {
  encodeUniformName,
  HistoryMode,
  HostPlatform,
  LocationKind,
  recordFileKey,
  recordSchema,
  resolveInstallationPath,
  resolveSettings,
  settingsSchema,
  WORKSPACE_SCHEMA,
  workspaceJsonSchema
} from "../index.ts";

test("strict schema requires lowercase UUIDv7, uniform names, explicit history mode and JSON values", () => {
  const f = records();
  for (const record of [
    { ...f.game, id: f.game.id.toUpperCase() },
    { ...f.game, id: `${f.game.id.slice(0, 14)}4${f.game.id.slice(15)}` },
    { ...f.game, schemaVersion: "workspace.experimental.2" },
    { ...f.game, uniformName: undefined },
    { ...f.game, typo: true },
    { ...f.workspace, history: { adapterId: null } },
    { ...f.host, sources: [{ ...f.host.sources[0], roots: [] }] }
  ])
    assert.throws(() => recordSchema.parse(record));
  for (const value of [null, { nested: null }, Infinity, NaN, 9007199254740992, new Date()])
    assert.throws(() => settingsSchema.parse({ adapterOptions: { example: { value } } }));
  assert.equal(
    recordSchema.parse({
      ...f.workspace,
      history: { mode: HistoryMode.Adapter, adapterId: "example" }
    }).schemaVersion,
    WORKSPACE_SCHEMA
  );
  assert.equal(
    (workspaceJsonSchema() as { $schema: string }).$schema,
    "https://json-schema.org/draft/2020-12/schema"
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
  ])
    assert.throws(() => settingsSchema.parse(settings));
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

test("Host platform controls absolute and relative path validation without touching target files", () => {
  const f = records();
  for (const path of ["../escape", "../../Games2", "D:relative", "D:/absolute", "\\rooted"])
    assert.throws(() =>
      resolveInstallationPath(
        { ...f.installation, location: { kind: LocationKind.Relative, rootKey: "games", path } },
        f.host
      )
    );
  assert.throws(
    () =>
      resolveInstallationPath(
        {
          ...f.installation,
          location: { kind: LocationKind.Relative, rootKey: "missing", path: "game" }
        },
        f.host
      ),
    /Unknown Host root/
  );
  const linux = { ...f.host, platform: HostPlatform.Linux, roots: { games: "/games" } };
  assert.equal(resolveInstallationPath(f.installation, linux), "/games/Synthetic");
  assert.throws(() =>
    resolveInstallationPath(
      { ...f.installation, location: { kind: LocationKind.Absolute, path: "C:/Games" } },
      linux
    )
  );
  assert.equal(
    resolveInstallationPath(
      {
        ...f.installation,
        location: { kind: LocationKind.Absolute, path: "\\\\server\\share\\Game" }
      },
      f.host
    ),
    "\\\\server\\share\\Game"
  );
});
