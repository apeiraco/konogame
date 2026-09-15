import { Effect } from "effect";
import { expect, test } from "vitest";
import { runUiEffect } from "../run-ui-effect.ts";

test("bridge preserves typed failures and defects at the framework boundary", async () => {
  const failure = new Error("typed");
  const defect = new Error("defect");
  await expect(runUiEffect(Effect.fail(failure))).rejects.toBe(failure);
  await expect(runUiEffect(Effect.die(defect))).rejects.toBe(defect);
});
