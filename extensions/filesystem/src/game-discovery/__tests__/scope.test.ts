import assert from "node:assert/strict";
import { test } from "vitest";
import { directoryDiscoveryScopeSchema } from "../scope.ts";

test("directory discovery scope accepts explicit absolute paths and rejects traversal exclusions", () => {
  for (const path of ["D:/Games", "/games", "\\\\server\\share\\Games"]) {
    assert.equal(
      directoryDiscoveryScopeSchema.assert({ paths: [path], maxDepth: 0, exclude: ["cache/old"] })
        .paths[0],
      path
    );
  }
  for (const paths of [[], ["Games"], ["D:Games"], ["C:/Games\0private"]]) {
    assert.throws(() => directoryDiscoveryScopeSchema.assert({ paths, maxDepth: 1, exclude: [] }));
  }
  for (const exclude of [
    ["../private"],
    ["/private"],
    ["D:/private"],
    ["foo\\bar"],
    ["foo//bar"]
  ]) {
    assert.throws(() =>
      directoryDiscoveryScopeSchema.assert({ paths: ["D:/Games"], maxDepth: 1, exclude })
    );
  }
  assert.throws(() =>
    directoryDiscoveryScopeSchema.assert({ paths: ["D:/Games"], maxDepth: 17, exclude: [] })
  );
});
