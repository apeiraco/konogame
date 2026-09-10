import { parseArgsSync } from "@optique/testing/parser";
import { describe, expect, test } from "vitest";
import { cliParser, normalizeCliTokens } from "../parser/index.ts";

describe("CLI parser", () => {
  test("accepts nested command paths and records mutually exclusive interaction flags", () => {
    const rename = parseArgsSync(cliParser, [
      "workspace",
      "rename",
      "root",
      "record",
      "name",
      "--expected-revision",
      "rev"
    ]);
    expect(rename.success).toBe(true);
    if (rename.success) {
      expect(rename.value.kind).toBe("workspace rename");
      if (rename.value.kind === "workspace rename")
        expect(rename.value.expectedRevision).toBe("rev");
    }
    const both = parseArgsSync(cliParser, ["features", "--interactive", "--non-interactive"]);
    expect(both.success).toBe(true);
    if (both.success && both.value.kind === "features") {
      expect(both.value.interactive).toBe(true);
      expect(both.value.nonInteractive).toBe(true);
    }
    expect(parseArgsSync(cliParser, ["missing"]).success).toBe(false);
  });

  test("normalizes explicit interaction flags only before the positional boundary", () => {
    expect(normalizeCliTokens(["--interactive=true", "features"])).toEqual([
      "--interactive",
      "features"
    ]);
    expect(normalizeCliTokens(["--interactive=false", "features"])).toEqual([
      "--non-interactive",
      "features"
    ]);
    expect(normalizeCliTokens(["plan", "save.store", "--", "--interactive=false"])).toEqual([
      "plan",
      "save.store",
      "--",
      "--interactive=false"
    ]);
  });
});
