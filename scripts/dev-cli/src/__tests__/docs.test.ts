import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { checkDocs } from "../docs/check.ts";

it.layer(NodeFileSystem.layer)((it) => {
  it.effect("documentation checker recursively validates fixture links", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* Effect.acquireRelease(
        Effect.promise(() => createTestDirectory(import.meta.dirname, "unit", "docs")),
        (path) => fs.remove(path, { recursive: true, force: true }).pipe(Effect.orDie)
      );
      yield* fs.makeDirectory(join(root, "docs/en/archive"), { recursive: true });
      yield* fs.makeDirectory(join(root, "docs/zh"), { recursive: true });
      yield* fs.writeFileString(
        join(root, "README.md"),
        "[English](README.md) | [中文](docs/zh/README.md)"
      );
      yield* fs.writeFileString(join(root, "AGENTS.md"), "Fixture instructions");
      yield* fs.writeFileString(
        join(root, "docs/zh/README.md"),
        "[English](../../README.md) | [中文](README.md)"
      );
      yield* fs.writeFileString(join(root, "docs/en/archive/old.md"), "Historical text");
      expect(yield* checkDocs(root)).toEqual({ documents: 4 });
      yield* fs.writeFileString(join(root, "docs/en/archive/old.md"), "[Broken](missing.md)");
      const failed = yield* Effect.result(checkDocs(root));
      expect(failed).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DevCliError", message: expect.stringContaining("missing missing.md") }
      });
    })
  );
});
