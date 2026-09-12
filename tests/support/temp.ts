import { mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { v7 as uuidv7 } from "uuid";

// The operating-system temporary directory is often a small tmpfs. Keep disposable test files on the project volume.
const HIERARCHY_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function createTestDirectory(anchor: string, ...hierarchy: string[]): Promise<string> {
  if (hierarchy.length === 0) {
    throw new Error("A test temp directory needs a stable hierarchy");
  }
  for (const segment of hierarchy) {
    if (!HIERARCHY_SEGMENT.test(segment) || UUID_V7.test(segment)) {
      throw new Error(`Test temp hierarchy entries must be stable lowercase names: ${segment}`);
    }
  }
  const directory = join(testTempRoot(anchor), ...hierarchy, uuidv7());
  await mkdir(directory, { recursive: true });
  return directory;
}

function testTempRoot(anchor: string): string {
  let current = resolve(anchor);
  while (basename(current) !== "tests" && basename(current) !== "__tests__") {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`No tests directory above ${anchor}`);
    }
    current = parent;
  }
  const parent = dirname(current);
  let cursor = parent;
  while (basename(cursor) !== "src") {
    const next = dirname(cursor);
    if (next === cursor) {
      break;
    }
    cursor = next;
  }
  const owner = basename(cursor) === "src" ? dirname(cursor) : parent;
  return join(owner, "temp", "tests");
}
