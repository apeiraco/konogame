import assert from "node:assert/strict";
import { test } from "vitest";
import { releaseNotes } from "../release.ts";

test("release notes require the exact group/version and exclude language footers", () => {
  for (const newline of ["\n", "\r\n"]) {
    const source = [
      "# Changelog",
      "## 0.1.0-alpha.0",
      "- Core",
      "## konogame.filesystem@0.1.0-alpha.0",
      "- Extension",
      "[English](CHANGELOG.md) | [中文](docs/zh/CHANGELOG.md)"
    ].join(newline);
    assert.equal(releaseNotes(source, "0.1.0-alpha.0"), "- Core");
    assert.equal(releaseNotes(source, "0.1.0-alpha.0", "konogame.filesystem"), "- Extension");
    assert.throws(() => releaseNotes(source, "0.1.0"), /exact changelog section/);
  }
});
