import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import {
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind,
  FeatureNotFoundError,
  infrastructureRule
} from "../errors.ts";

it.effect("known feature refusals stay failures and unknown throws stay defects", () =>
  Effect.gen(function* () {
    const missing = new FeatureNotFoundError({
      issue: { kind: "feature", id: "missing" },
      message: "missing"
    });
    const unavailable = new AdapterResolutionUnavailableError({
      issue: { kind: AdapterResolutionUnavailableKind.Resolution, featureId: "save.store" },
      message: "unavailable"
    });
    assert.equal(
      yield* Effect.flip(
        infrastructureRule("plan", () => {
          throw missing;
        })
      ),
      missing
    );
    const exit = yield* Effect.exit(
      infrastructureRule("plan", () => {
        throw unavailable;
      })
    );
    assert.ok(Exit.isFailure(exit));
    assert.equal(Cause.hasFails(exit.cause), false);
    assert.equal(exit.cause.reasons.filter(Cause.isDieReason)[0]?.defect, unavailable);
  })
);
