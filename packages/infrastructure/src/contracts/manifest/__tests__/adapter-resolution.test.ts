import assert from "node:assert/strict";
import { type } from "arktype";
import { test } from "vitest";
import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  type AdapterResolutionRequest,
  configurationValueSchema,
  DECLARATION_PROTOCOL_RANGE,
  type LocationContract,
  LocationOperation,
  LocationPortId,
  locationContractSchema,
  selectAdapters
} from "../../index.ts";

function descriptor(): AdapterDescriptor {
  return {
    id: "sample.location",
    owner: { kind: AdapterOwnerKind.Extension, id: "sample" },
    port: LocationPortId,
    declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
    portVersionRange: "^0.2.0",
    operations: Object.values(LocationOperation),
    capabilities: ["identity"],
    locations: [
      { type: "sample.object", schemaRange: "^1.0.0" },
      { type: "sample.alias", schemaRange: "^2.0.0" }
    ]
  };
}
const location: LocationContract = {
  type: "sample.object",
  schemaVersion: "1.1.0",
  data: { id: "A" }
};
function request(locations: readonly LocationContract[] = [location]): AdapterResolutionRequest {
  return {
    feature: {
      id: "location.compare",
      port: LocationPortId,
      operation: LocationOperation.Compare,
      portVersion: "0.2.0",
      requiredCapabilities: ["identity"]
    },
    locations
  };
}
test("Location envelopes preserve JSON data and reject values outside the JSON subset", () => {
  const data = JSON.parse(
    '{"__proto__":{"constructor":"淇濈暀"},"constructor":[],"prototype":{},"nested":{"unicode":"娓告垙"}}'
  );
  const unknown = { type: "future.resource", schemaVersion: "9.3.0", data };
  const parsed = locationContractSchema.assert(unknown);
  assert.equal(JSON.stringify(parsed), JSON.stringify(unknown));
  assert.equal(Object.hasOwn(parsed.data as object, "__proto__"), true);
  for (const value of [
    null,
    undefined,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    { nested: null }
  ]) {
    assert.equal(configurationValueSchema(value) instanceof type.errors, true);
  }
  assert.equal(
    configurationValueSchema({ float: 1.5, empty: [], object: {} }) instanceof type.errors,
    false
  );
});

test("pure Adapter resolution negotiation checks both Location schemas plus declaration protocol, Port version, operation, capability and preference", () => {
  const adapter = descriptor();
  assert.equal(
    selectAdapters(
      [request([location, { type: "sample.alias", schemaVersion: "2.1.0", data: {} }])],
      [adapter]
    ).resolvedAdapters.length,
    1
  );
  for (const invalid of [
    { ...adapter, declarationProtocolRange: "^9.0.0" },
    { ...adapter, operations: [LocationOperation.Validate] },
    { ...adapter, capabilities: [] },
    { ...adapter, locations: [{ type: "sample.object", schemaRange: "^1.0.0" }] }
  ]) {
    assert.equal(
      selectAdapters(
        [request([location, { type: "sample.alias", schemaVersion: "2.0.0", data: {} }])],
        [invalid]
      ).resolvedAdapters.length,
      0
    );
  }
  assert.equal(
    selectAdapters([request([location, { ...location, schemaVersion: "2.0.0" }])], [adapter])
      .resolvedAdapters.length,
    0
  );
  assert.equal(
    selectAdapters([{ ...request(), preferredAdapterId: "missing" }], [adapter]).resolvedAdapters
      .length,
    0
  );
});

test("Location schema versions preserve build metadata and reject noncanonical spellings", () => {
  for (const schemaVersion of ["1.0.0+synthetic", "1.2.3-rc.1+build.001", "0.0.0+0001.A-b"]) {
    assert.equal(
      locationContractSchema.assert({ ...location, schemaVersion }).schemaVersion,
      schemaVersion
    );
  }
  for (const schemaVersion of [
    "v1.0.0+synthetic",
    "=1.0.0+synthetic",
    " 1.0.0+synthetic",
    "1.0.0+synthetic ",
    "1.0.0+synthetic\n",
    "1.0",
    "01.0.0",
    "1.0.0-01+synthetic",
    "1.0.0+",
    "1.0.0+bad..build"
  ]) {
    assert.equal(
      locationContractSchema({ ...location, schemaVersion }) instanceof type.errors,
      true
    );
  }
});
