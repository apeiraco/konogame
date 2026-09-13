import assert from "node:assert/strict";
import { type } from "arktype";
import { test } from "vitest";
import {
  adapterDescriptorSchema,
  assertDeclarationInput,
  type ExternalSchema,
  extensionManifestSchema,
  featureSchema,
  moduleManifestSchema,
  toInternalSchema,
  toTransmittedSchema
} from "../../index.ts";

const adapter = {
  id: "synthetic.adapter",
  owner: { kind: "extension", id: "synthetic" },
  port: "synthetic.port",
  declarationProtocolRange: "^0.2.0",
  portVersionRange: "^0.2.0",
  operations: ["read"],
  capabilities: ["streaming"]
};
const manifest = {
  id: "synthetic",
  version: "1.0.0+build.1",
  declarationProtocolRange: "^0.2.0",
  software: { game: "^1.0.0", untested: "latest", protocol: "generic" },
  contributes: { adapters: [adapter] }
};

test("strict manifest schemas validate complete declarations without loading implementation code", () => {
  assert.deepEqual(extensionManifestSchema.assert(manifest), manifest);
  for (const changes of [
    { id: " " },
    { version: "v1.0.0" },
    { declarationProtocolRange: "invalid" },
    { software: [] },
    { software: { game: 4 } },
    { software: { game: "unstable" } },
    { software: { " ": "latest" } },
    { contributes: { commands: [] } },
    { activationEvents: "onStartup" },
    { activationEvents: ["onStartup", "onStartup"] },
    { activationEvents: ["onFeature:"] },
    { activationEvents: [true] },
    { dependencies: [{ extensionId: "base", versionRange: 1 }] },
    { dependencies: [{ extensionId: "base", versionRange: "*", optional: true }] },
    {
      dependencies: [
        { extensionId: "base", versionRange: "*" },
        { extensionId: "base", versionRange: "*" }
      ]
    },
    { contributes: { adapters: [null] } },
    { future: true }
  ]) {
    assert.throws(() => extensionManifestSchema.assert({ ...manifest, ...changes }));
  }
});

test("Adapter and Feature schemas reject malformed arrays, duplicates and nonfinite priority", () => {
  for (const changes of [
    { portVersionRange: undefined },
    { portVersionRange: "latest" },
    { operations: "read" },
    { operations: ["read", "read"] },
    { operations: [""] },
    { capabilities: undefined },
    { capabilities: [1] },
    { capabilities: ["streaming", "streaming"] },
    { owner: { kind: "provider", id: "synthetic" } },
    { owner: { kind: "extension", id: " " } },
    { priority: Infinity },
    { priority: NaN },
    { priority: "1" },
    { locations: [{ type: "future.resource", schemaRange: "*", extra: true }] },
    {
      locations: [
        { type: "future.resource", schemaRange: "*" },
        { type: "future.resource", schemaRange: "^1" }
      ]
    }
  ]) {
    assert.throws(() => adapterDescriptorSchema.assert({ ...adapter, ...changes }));
  }
  const feature = {
    id: "synthetic.read",
    port: "synthetic.port",
    operation: "read",
    portVersion: "0.2.0",
    requiredCapabilities: []
  };
  assert.deepEqual(featureSchema.assert(feature), feature);
  for (const changes of [
    { portVersion: undefined },
    { portVersion: "^0.2.0" },
    { portVersion: "v0.2.0" },
    { id: "" },
    { operation: 1 },
    { requiredCapabilities: "streaming" },
    { extra: true }
  ]) {
    assert.throws(() => featureSchema.assert({ ...feature, ...changes }));
  }
  assert.throws(() =>
    moduleManifestSchema.assert({
      id: "module",
      declarationProtocolRange: "*",
      features: [feature, feature]
    })
  );
});

test("manifest input rejects accessors, sparse arrays and class instances without reading properties", () => {
  let reads = 0;
  const accessor = Object.defineProperty({ ...manifest }, "id", {
    enumerable: true,
    get() {
      reads++;
      return "synthetic";
    }
  });
  class Manifest {
    id = "synthetic";
  }
  for (const value of [accessor, new Manifest(), { ...manifest, activationEvents: Array(1) }]) {
    assert.throws(() => {
      assertDeclarationInput(value);
      extensionManifestSchema.assert(value);
    });
  }
  assert.equal(reads, 0);
});

test("Location declarations support portable JSON and Standard Schemas and reject invalid schemas", () => {
  const schemas: ExternalSchema[] = [
    true,
    false,
    {},
    { type: "object", properties: { marker: { type: "string" } } },
    type({ marker: "string" })
  ];
  for (const dataSchema of schemas) {
    const input = {
      ...manifest,
      contributes: {
        locations: [
          {
            type: "synthetic.resource",
            schemaVersion: "1.0.0+build",
            schemaRange: "^1",
            dataSchema
          }
        ]
      }
    };
    assert.doesNotThrow(() => extensionManifestSchema.assert(input));
    assert.equal(typeof toTransmittedSchema(toInternalSchema(dataSchema)), "object");
  }
  for (const dataSchema of [
    null,
    [],
    "string",
    { type: "imaginary" },
    { type: "object", properties: 42 }
  ]) {
    assert.throws(() =>
      extensionManifestSchema.assert({
        ...manifest,
        contributes: {
          locations: [
            { type: "synthetic.resource", schemaVersion: "1.0.0", schemaRange: "^1", dataSchema }
          ]
        }
      })
    );
  }
});
