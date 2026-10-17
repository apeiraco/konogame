import { access, readdir, readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

export function repositoryRoot(): string {
  return resolve(import.meta.dirname, "../../..");
}

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

export async function checkDocs(base = repositoryRoot()): Promise<{ documents: number }> {
  const discovered = [
    resolve(base, "README.md"),
    resolve(base, "AGENTS.md"),
    ...(await markdownFiles(resolve(base, "docs/en"))),
    ...(await markdownFiles(resolve(base, "docs/zh")))
  ];
  // Relative links in a projection belong to its canonical source, checked once.
  const files = new Set(await Promise.all(discovered.map((file) => realpath(file))));
  const errors: string[] = [];
  for (const file of files) {
    const name = relative(base, file).split(sep).join("/");
    const source = await readFile(file, "utf8");
    if (
      name !== "AGENTS.md" &&
      !name.includes("/archive/") &&
      !(source.includes("[English](") && source.includes("[中文]("))
    ) {
      errors.push(`${name}: missing language links`);
    }
    for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1]?.split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      try {
        await access(resolve(dirname(file), decodeURIComponent(target)));
      } catch {
        errors.push(`${name}: missing ${target}`);
      }
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return { documents: files.size };
}
