import assert from "node:assert/strict";
import { test } from "vitest";
import { DECLARATION_PROTOCOL_RANGE, supportsDeclarationProtocolRange } from "../../index.ts";

// Ordinary range membership belongs to semver's own test suite. These cases cover only the
// project rule: compatibility is decided by the generated protocol constants, and software
// markers such as `latest` or `generic` never stand in for a declaration protocol range.
test("the declared declaration protocol range accepts the current declaration protocol version", () => {
  assert.equal(supportsDeclarationProtocolRange(DECLARATION_PROTOCOL_RANGE), true);
});

test("software markers are rejected instead of being read as declaration protocol ranges", () => {
  for (const marker of ["latest", "generic"]) {
    assert.equal(supportsDeclarationProtocolRange(marker), false);
  }
});
