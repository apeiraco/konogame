import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { checkDocs } from "../../src/docs.ts";

test("documentation checker recursively validates fixture links", async () => {
  const root = await mkdtemp(join(tmpdir(), "konogame-docs-"));
  try {
    await mkdir(join(root, "docs/en/archive"), { recursive: true });
    await mkdir(join(root, "docs/zh"), { recursive: true });
    await writeFile(join(root, "README.md"), "[English](README.md) | [中文](docs/zh/README.md)");
    await writeFile(join(root, "AGENTS.md"), "Fixture instructions");
    await writeFile(
      join(root, "docs/zh/README.md"),
      "[English](../../README.md) | [中文](README.md)"
    );
    await writeFile(join(root, "docs/en/archive/old.md"), "Historical text");
    expect(await checkDocs(root)).toEqual({ documents: 4 });
    await writeFile(join(root, "docs/en/archive/old.md"), "[Broken](missing.md)");
    await expect(checkDocs(root)).rejects.toThrow(/missing missing.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
