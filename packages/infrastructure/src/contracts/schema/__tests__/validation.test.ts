import assert from "node:assert/strict";
import { type } from "arktype";
import { it } from "vitest";
import { assertSchema, SchemaValidationError } from "../validation.ts";

it("schema rejection has structured paths while success retains inference", () => {
  const schema = type({ title: "string", nested: { count: "number" } });
  const value = assertSchema("test.record", schema, { title: "test", nested: { count: 2 } });
  const count: number = value.nested.count;
  assert.equal(count, 2);
  assert.throws(
    () => assertSchema("test.record", schema, { title: 3, nested: { count: "bad" } }),
    (error) => {
      assert.ok(error instanceof SchemaValidationError);
      assert.equal(error.schemaId, "test.record");
      assert.deepEqual(error.issues.map(({ path }) => path).sort(), [
        ["nested", "count"],
        ["title"]
      ]);
      return true;
    }
  );
});
