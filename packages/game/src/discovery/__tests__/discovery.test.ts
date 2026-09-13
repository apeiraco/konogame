import assert from "node:assert/strict";
import { test } from "vitest";
import { discoveryObservationSchema } from "../../index.ts";
import { discoveryScopeSchema } from "../contract.ts";

test("discovery scope is an opaque bounded object", () => {
  const scope = { paths: ["D:/Games"], maxDepth: 1, exclude: ["cache/old"] };
  assert.deepEqual(discoveryScopeSchema.assert(scope), scope);
  assert.throws(() => discoveryScopeSchema.assert(["D:/Games"]));
  assert.throws(() => discoveryScopeSchema.assert("D:/Games"));
  assert.throws(() => discoveryScopeSchema.assert({ note: "x".repeat(300_000) }));
});

test("candidate observations require evidence and cannot carry entity records or launch instructions", () => {
  const candidate = {
    observationKey: "directory:sample",
    title: "Sample",
    location: { type: "fs.absolute", schemaVersion: "1.0.0", data: { path: "/games/sample" } },
    externalRefs: [],
    evidence: [{ kind: "directory", path: "library/sample", fingerprint: "sha256:sample" }]
  };
  assert.deepEqual(discoveryObservationSchema.assert(candidate), candidate);
  assert.throws(() => discoveryObservationSchema.assert({ ...candidate, gameId: "injected" }));
  assert.throws(() => discoveryObservationSchema.assert({ ...candidate, launchEntries: [] }));
  assert.throws(() => discoveryObservationSchema.assert({ ...candidate, evidence: [] }));
});
