import assert from "node:assert/strict";
import { test } from "vitest";
import { ConfigurationInvalidInputError } from "../../operations/errors.ts";
import { assertConfigurationRecordSize, CONFIGURATION_RECORD_BYTE_LIMIT } from "../limits.ts";

test("record text accepts the byte limit and refuses the next byte", () => {
  assert.doesNotThrow(() =>
    assertConfigurationRecordSize("x".repeat(CONFIGURATION_RECORD_BYTE_LIMIT))
  );
  assert.throws(
    () => assertConfigurationRecordSize(`${"x".repeat(CONFIGURATION_RECORD_BYTE_LIMIT)}y`),
    ConfigurationInvalidInputError
  );
});
