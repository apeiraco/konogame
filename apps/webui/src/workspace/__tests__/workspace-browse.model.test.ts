import { describe, expect, it } from "vitest";
import { indentDepth, treeLevel } from "../workspace-browse.model.ts";

describe("browse tree indentation", () => {
  it("indents every level normally near the top of the tree", () => {
    expect([1, 2, 3].map((level) => indentDepth(level, 1))).toEqual([0, 1, 2]);
    expect([1, 2, 3].map((level) => indentDepth(level, 2))).toEqual([0, 1, 2]);
  });

  it("keeps parent, current and child levels apart and flattens older ancestors", () => {
    // Reading level 5: levels 1–4 share a column, 5 and 6 step in.
    expect([1, 2, 3, 4, 5, 6].map((level) => indentDepth(level, 5))).toEqual([0, 0, 0, 0, 1, 2]);
  });

  it("derives the level from the path-unique node value", () => {
    const separator = "\u001f";
    expect(treeLevel(["@start", "a"].join(separator), separator)).toBe(1);
    expect(treeLevel(["@start", "a", "b", "#loading"].join(separator), separator)).toBe(3);
  });
});
