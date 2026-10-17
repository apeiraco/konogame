import assert from "node:assert/strict";
import { test } from "vitest";
import { supportsContractRange } from "../index.ts";

test("Contract ranges are distinct from release versions and software markers", () => {
  assert.equal(supportsContractRange(">=0.1.0 <0.2.0"), true);
  assert.equal(supportsContractRange("^0.1.0", "0.1.9"), true);
  assert.equal(supportsContractRange("^0.1.0", "0.2.0"), false);
  assert.equal(supportsContractRange("^0.1.0", "0.1.1-alpha.0"), false);
  assert.equal(supportsContractRange(">=0.1.1-alpha.0 <0.1.1", "0.1.1-alpha.1"), true);
  for (const range of ["latest", "generic", "incompatible"])
    assert.equal(supportsContractRange(range), false);
});
