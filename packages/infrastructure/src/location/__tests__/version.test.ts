import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  DECLARATION_PROTOCOL_RANGE,
  LocationCapability,
  LocationComparisonStatus,
  LocationOperation,
  LocationPortId,
  LocationTypeStatus,
  locationImplementation
} from "@konogame/infrastructure/contracts";
import { Effect, Exit } from "effect";
import { extension, setup } from "../../__tests__/support.ts";
import { defineExtensionModule } from "../../index.ts";

it.effect("Location definitions preserve canonical SemVer build metadata", () =>
  Effect.gen(function* () {
    const location = {
      type: "synthetic.object",
      schemaVersion: "1.0.0+synthetic",
      data: { id: "sample" }
    };
    const item = extension("location", {
      manifest: {
        contributes: {
          locations: [
            {
              type: location.type,
              schemaVersion: location.schemaVersion,
              schemaRange: "^1.0.0",
              dataSchema: { type: "object" }
            }
          ]
        }
      }
    });
    const env = yield* setup([item]);
    yield* env.lifecycle.prepared;
    assert.equal(
      env.extensions.getLocationType(location.type)!.definition.schemaVersion,
      location.schemaVersion
    );
    assert.equal(env.extensions.checkLocation(location).status, LocationTypeStatus.Supported);
    assert.equal(
      env.extensions.checkLocation({ ...location, schemaVersion: "2.0.0+other.001" }).status,
      LocationTypeStatus.Unverified
    );
  })
);
it.effect("noncanonical Location versions fail registration atomically", () =>
  Effect.gen(function* () {
    const env = yield* setup();
    yield* env.lifecycle.prepared;
    const before = env.extensions.snapshot;
    for (const schemaVersion of ["v1.0.0", "1.0", "01.0.0"]) {
      const item = extension("invalid", {
        manifest: {
          declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
          contributes: {
            locations: [
              {
                type: "synthetic.object",
                schemaVersion,
                schemaRange: "*",
                dataSchema: { type: "object" }
              }
            ]
          }
        }
      });
      assert.ok(Exit.isFailure(yield* Effect.exit(env.extensions.register(item))));
      assert.equal(env.extensions.snapshot, before);
    }
  })
);

it.effect(
  "both Location resolution operands retain build metadata and require compatible schemas",
  () =>
    Effect.gen(function* () {
      const left = {
        type: "synthetic.left",
        schemaVersion: "1.0.0+synthetic",
        data: { id: "same" }
      };
      const right = {
        type: "synthetic.right",
        schemaVersion: "2.0.0+other.001",
        data: { id: "same" }
      };
      const item = extension("locations", {
        manifest: {
          contributes: {
            adapters: [
              {
                id: "locations.compare",
                owner: { kind: "extension", id: "locations" },
                port: LocationPortId,
                operations: [LocationOperation.Compare],
                capabilities: [LocationCapability.Compare],
                declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
                portVersionRange: "^0.2.0",
                locations: [
                  { type: left.type, schemaRange: "~1.0.0" },
                  { type: right.type, schemaRange: "~2.0.0" }
                ]
              }
            ],
            locations: [left, right].map((location) => ({
              type: location.type,
              schemaVersion: location.schemaVersion,
              schemaRange: `^${location.schemaVersion.split("+")[0]}`,
              dataSchema: { type: "object" }
            }))
          }
        },
        module: defineExtensionModule({
          activate: (context) =>
            context.registerAdapter("locations.compare", locationImplementation, {
              compare: () => Effect.succeed({ status: LocationComparisonStatus.Equal })
            })
        })
      });
      const env = yield* setup([item]);
      const feature = {
        id: "location.compare",
        port: LocationPortId,
        operation: LocationOperation.Compare,
        portVersion: "0.2.0",
        requiredCapabilities: [LocationCapability.Compare]
      };
      const plan = yield* env.adapterResolver.resolve([{ feature, locations: [left, right] }]);
      assert.equal(plan.resolvedAdapters.length, 1);
      assert.equal(
        (yield* env.adapterResolver.implementation(
          plan.resolvedAdapters[0]!,
          locationImplementation
        ).compare!({
          left,
          right
        })).status,
        LocationComparisonStatus.Equal
      );
      assert.equal(
        (yield* env.adapterResolver.resolve([
          { feature, locations: [left, { ...right, schemaVersion: "3.0.0" }] }
        ])).resolvedAdapters.length,
        0
      );
    })
);
