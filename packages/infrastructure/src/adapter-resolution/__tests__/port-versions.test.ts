import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { type AdapterDescriptor, selectAdapters } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { test } from "vitest";
import { extension, feature, request, setup } from "../../__tests__/support.ts";

it.effect("incompatible Port declarations stay unloaded while a compatible Port activates", () =>
  Effect.gen(function* () {
    let incompatibleLoads = 0;
    const incompatible = extension("old-port", {
      load: () =>
        Effect.sync(() => {
          incompatibleLoads++;
          throw new Error("An incompatible Adapter must never load");
        })
    });
    const compatible = extension("current-port");
    const env = yield* setup([incompatible, compatible]);
    const upgraded = { ...feature, portVersion: "0.3.0" };
    const refused = yield* env.adapterResolver.resolve([{ feature: upgraded }]);
    assert.equal(refused.resolvedAdapters.length, 0);
    assert.equal(incompatibleLoads, 0);
    const selected = yield* env.adapterResolver.resolve([
      { ...request, preferredAdapterId: "current-port.adapter" }
    ]);
    assert.equal(selected.resolvedAdapters[0]!.adapterId, "current-port.adapter");
    assert.equal(selected.resolvedAdapters[0]!.portVersionRange, "^0.2.0");
    assert.equal(incompatibleLoads, 0);
  })
);

test("third-party Ports negotiate their own versions without a built-in Port registry", () => {
  const customFeature = {
    id: "third-party.inspect",
    port: "third-party.inspection",
    portVersion: "17.4.0",
    operation: "inspect",
    requiredCapabilities: []
  };
  const adapter: AdapterDescriptor = {
    id: "third-party.adapter",
    owner: { kind: "extension", id: "third-party" },
    port: customFeature.port,
    declarationProtocolRange: "^0.2.0",
    portVersionRange: ">=17.0.0 <18.0.0",
    operations: ["inspect"],
    capabilities: []
  };
  const plan = selectAdapters([{ feature: customFeature }], [adapter]);
  assert.equal(plan.resolvedAdapters[0]!.portVersion, "17.4.0");
  assert.equal(plan.resolvedAdapters[0]!.portVersionRange, ">=17.0.0 <18.0.0");
});
