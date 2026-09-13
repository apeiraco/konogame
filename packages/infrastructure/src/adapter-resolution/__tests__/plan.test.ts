import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { selectAdapters } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { test } from "vitest";
import {
  descriptor,
  extension,
  feature,
  moduleContribution,
  setup
} from "../../__tests__/support.ts";
import { AdapterResolutionPlanner } from "../plan.ts";

const syntheticAdapter = descriptor("synthetic");

function resolve(adapter = syntheticAdapter, preferredAdapterId?: string) {
  return selectAdapters([{ feature, preferredAdapterId }], [adapter]);
}
it.effect("active third-party Adapter binds its Feature without built-in Modules", () =>
  Effect.gen(function* () {
    const module = moduleContribution();
    if (module.kind !== "module") {
      throw new Error("Expected Module contribution");
    }
    const env = yield* setup([
      {
        ...module,
        manifest: {
          ...module.manifest,
          features: [
            feature,
            {
              ...feature,
              id: "synthetic.optional",
              requiredCapabilities: ["optional.history"]
            }
          ]
        }
      },
      extension("synthetic")
    ]);
    yield* env.lifecycle.initialize();
    const plan = yield* new AdapterResolutionPlanner(env.adapterResolver).plan([
      feature.id,
      "synthetic.optional"
    ]);
    assert.equal(plan.resolvedAdapters[0]?.adapterId, syntheticAdapter.id);
    assert.equal(plan.unavailable[0]?.feature, "synthetic.optional");
  })
);

test("explicit preference never falls back and incompatible declaration protocol is rejected", () => {
  assert.equal(resolve(undefined, "unknown").resolvedAdapters.length, 0);
  assert.equal(
    resolve({ ...syntheticAdapter, declarationProtocolRange: "2.0.0" }).unavailable.length,
    1
  );
});
test("pure resolution accepts declaration protocol ranges and rejects unsupported ranges", () => {
  for (const declarationProtocolRange of [">=0.2.0 <0.3.0", "^0.2.0", "0.2.x"]) {
    assert.equal(
      resolve({ ...syntheticAdapter, declarationProtocolRange }).resolvedAdapters[0]
        ?.declarationProtocolRange,
      declarationProtocolRange
    );
  }
  for (const declarationProtocolRange of [">=0.3.0", "latest", "generic", "invalid"]) {
    assert.equal(
      resolve({ ...syntheticAdapter, declarationProtocolRange }).resolvedAdapters.length,
      0
    );
  }
});
