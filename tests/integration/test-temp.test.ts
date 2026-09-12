import { readdir, readFile, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createTestDirectory } from "../support/temp.ts";

const repository = resolve(import.meta.dirname, "../..");
const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("creates a repository temp hierarchy with a UUIDv7 leaf", async () => {
  const directory = await createTestDirectory(import.meta.dirname, "support", "sample");
  created.push(directory);
  expect(relative(repository, dirname(directory)).replaceAll("\\", "/")).toBe(
    "temp/tests/support/sample"
  );
  expect(basename(directory)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test("creates workspace temp directories from package and unit anchors", async () => {
  const integration = await createTestDirectory(
    resolve(repository, "packages/workspace/tests/integration"),
    "integration",
    "workflow"
  );
  const unit = await createTestDirectory(
    resolve(repository, "packages/game/src/admission/__tests__"),
    "unit",
    "admission"
  );
  created.push(integration, unit);
  expect(relative(repository, dirname(integration)).replaceAll("\\", "/")).toBe(
    "packages/workspace/temp/tests/integration/workflow"
  );
  expect(relative(repository, dirname(unit)).replaceAll("\\", "/")).toBe(
    "packages/game/temp/tests/unit/admission"
  );
});

test("rejects random or unstable hierarchy names", async () => {
  await expect(createTestDirectory(import.meta.dirname)).rejects.toThrow(/hierarchy/);
  await expect(
    createTestDirectory(import.meta.dirname, "019a0000-0000-7000-8000-000000000001")
  ).rejects.toThrow(/stable/);
  await expect(createTestDirectory(import.meta.dirname, "MixedCase")).rejects.toThrow(/stable/);
});

test("test sources do not use the operating-system temporary directory", async () => {
  const hits: string[] = [];
  const skip = new Set([
    "node_modules",
    "dist",
    "dist-tsc",
    "temp",
    "projections",
    ".git",
    ".mise"
  ]);
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (skip.has(entry.name)) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      const name = relative(repository, path).replaceAll("\\", "/");
      const inTests =
        name.startsWith("tests/") || name.includes("/tests/") || name.includes("/__tests__/");
      if (!inTests || !name.endsWith(".ts") || name === "tests/integration/test-temp.test.ts") {
        continue;
      }
      const source = await readFile(path, "utf8");
      if (source.includes("tmp" + "dir") || source.includes("mkd" + "temp")) {
        hits.push(name);
      }
    }
  }
  await visit(repository);
  expect(hits).toEqual([]);
});
