import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { extension, setup } from "../../__tests__/support.ts";
import { ActivationStatus } from "../activation-contract.ts";
import { observeNativePromise, requireExtensionEffect } from "../callback-result.ts";
import { LifecyclePhase } from "../diagnostics.ts";

it("callback result checks do not read arbitrary then accessors", () => {
  let reads = 0;
  // biome-ignore lint/suspicious/noThenProperty: Verify that arbitrary thenable hooks are never executed.
  const value = Object.defineProperty({}, "then", {
    get() {
      reads++;
      throw new Error("must not read then");
    }
  });
  assert.equal(observeNativePromise(value), false);
  assert.throws(() => requireExtensionEffect(value as never, "expected Effect"), /expected Effect/);
  assert.equal(reads, 0);
});

it.effect("native Promise rejection observation bypasses an overridden then accessor", () =>
  Effect.gen(function* () {
    let reads = 0;
    // biome-ignore lint/suspicious/noThenProperty: Native observation must bypass overridden Promise hooks.
    const value = Object.defineProperty(Promise.reject(new Error("late rejection")), "then", {
      get() {
        reads++;
        throw new Error("must not read then");
      }
    });
    assert.equal(observeNativePromise(value), true);
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    assert.equal(reads, 0);
  })
);

it.effect("loaded module members are captured once and retain their receiver", () =>
  Effect.gen(function* () {
    let activateReads = 0;
    let layerReads = 0;
    let thenReads = 0;
    let activated = false;
    const module = {
      value: "module-receiver",
      get activate() {
        activateReads++;
        return function (this: { value: string }) {
          assert.equal(this.value, "module-receiver");
          activated = true;
          return Effect.void;
        };
      },
      get layer() {
        layerReads++;
        return function (this: { value: string }) {
          assert.equal(this.value, "module-receiver");
          return Layer.empty;
        };
      },
      // biome-ignore lint/suspicious/noThenProperty: A module's unrelated getter must remain untouched.
      get then() {
        thenReads++;
        throw new Error("module is not a thenable boundary");
      }
    };
    const env = yield* setup([extension("captured", { load: () => Effect.succeed(module) })]);
    yield* env.lifecycle.prepared;
    assert.equal((yield* env.activation.activate("captured")).status, ActivationStatus.Active);
    assert.equal(activated, true);
    assert.equal(activateReads, 1);
    assert.equal(layerReads, 1);
    assert.equal(thenReads, 0);
  })
);

it.effect("a layer factory returning undefined fails in the service construction phase", () =>
  Effect.gen(function* () {
    let activated = false;
    const env = yield* setup([
      extension("invalid-layer", {
        load: () =>
          Effect.succeed({
            layer: () => undefined,
            activate: () => {
              activated = true;
              return Effect.void;
            }
          })
      })
    ]);
    yield* env.lifecycle.prepared;
    const result = yield* env.activation.activate("invalid-layer");
    assert.equal(result.status, ActivationStatus.Failed);
    assert.equal(result.phase, LifecyclePhase.Providers);
    assert.match(result.reason!, /factory must return a Layer/);
    assert.equal(activated, false);
  })
);
