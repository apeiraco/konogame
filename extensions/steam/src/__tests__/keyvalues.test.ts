import { describe, expect, it } from "vitest";
import { KeyValuesParser } from "../keyvalues.ts";

describe("bounded data-only Valve KeyValues parser", () => {
  it("parses nested manifests, comments and escaped Windows paths", () => {
    expect(
      new KeyValuesParser(
        ' // comment\n "libraryfolders" { "0" { "path" "D:\\\\Synthetic" "apps" { "123" "0" } } }'
      ).parse()
    ).toEqual({ libraryfolders: { "0": { path: "D:\\Synthetic", apps: { "123": "0" } } } });
  });
  it("preserves quoted syntax characters and supported escapes as data", () => {
    expect(new KeyValuesParser('"#key" "{" "}" "\\n\\r\\t\\"\\\\"').parse()).toEqual({
      "#key": "{",
      "}": '\n\r\t"\\'
    });
  });
  it.each([
    '"a" { "b" "c"',
    '"a" "1" "a" "2"',
    '#include "other.vdf"',
    '"a" "1" [$WIN32]',
    '"a" "\\q"',
    "}"
  ])("rejects ambiguous or unsupported documents: %s", (source) => {
    expect(() => new KeyValuesParser(source).parse()).toThrow();
  });
  it("bounds nesting and token lengths", () => {
    expect(() =>
      new KeyValuesParser(`${'"a" {'.repeat(18)}"v" "1"${"}".repeat(18)}`).parse()
    ).toThrow("nesting");
    expect(() => new KeyValuesParser(`"a" "${"x".repeat(4097)}"`).parse()).toThrow("length");
  });
});
