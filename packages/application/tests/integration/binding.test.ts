import assert from "node:assert/strict";
import { KonogameApplication } from "@konogame/application";
import { filesystemSaveStoreAdapter } from "@konogame/extension-filesystem";
import { saveModule } from "@konogame/save";
import { test } from "vitest";

test("filesystem binds save.store but not optional history", () => {
  const app = new KonogameApplication([saveModule], [filesystemSaveStoreAdapter]);
  const plan = app.plan(["save.store", "save.history"]);
  assert.equal(plan.bindings[0]?.adapterId, "filesystem.save-store");
  assert.equal(plan.unavailable[0]?.feature, "save.history");
});

test("explicit preference never falls back and incompatible contract is rejected", () => {
  const app = new KonogameApplication([saveModule], [filesystemSaveStoreAdapter]);
  assert.equal(app.plan(["save.store"], { "save.store": "unknown" }).bindings.length, 0);
  const wrongVersion = {
    ...filesystemSaveStoreAdapter,
    id: "wrong-version",
    contractRange: "2.0.0"
  };
  const other = new KonogameApplication([saveModule], [wrongVersion]);
  assert.equal(other.plan(["save.store"]).unavailable.length, 1);
});

test("resolution accepts declared Contract ranges and rejects malformed ranges", () => {
  for (const contractRange of [">=0.1.0 <0.2.0", "^0.1.0", "0.1.x"]) {
    const adapter = { ...filesystemSaveStoreAdapter, contractRange };
    const app = new KonogameApplication([saveModule], [adapter]);
    assert.equal(app.plan(["save.store"]).bindings[0]?.contractRange, contractRange);
  }
  for (const contractRange of [">=0.2.0", "latest", "generic", "invalid"]) {
    const app = new KonogameApplication(
      [saveModule],
      [{ ...filesystemSaveStoreAdapter, contractRange }]
    );
    assert.equal(app.plan(["save.store"]).bindings.length, 0);
  }
  assert.throws(
    () => new KonogameApplication([{ ...saveModule, contractRange: ">=2.0.0" }], []),
    /does not support Contract/
  );
});
