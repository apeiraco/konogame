import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CORE_VERSION } from "@konogame/infrastructure/contracts";
import { Effect } from "effect";
import { test } from "vitest";
import { repositoryRoot, runDevCli } from "../main.ts";
import { releaseNotes } from "../release/notes.ts";

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

test("runDevCli resolves repositoryRoot and handles version and help options in-process", async () => {
  assert.equal(repositoryRoot(), resolve(import.meta.dirname, "../../../.."));
  let versionOut = "";
  const versionCode = await Effect.runPromise(
    runDevCli(["--version"], {
      stdout: (text) => {
        versionOut += text;
      },
      stderr() {}
    })
  );
  assert.equal(versionCode, 0);
  assert.equal(versionOut.trim(), CORE_VERSION);

  let helpOut = "";
  const helpCode = await Effect.runPromise(
    runDevCli(["--help"], {
      stdout: (text) => {
        helpOut += text;
      },
      stderr() {}
    })
  );
  assert.equal(helpCode, 0);
  assert.match(helpOut, /check-docs/);
});
