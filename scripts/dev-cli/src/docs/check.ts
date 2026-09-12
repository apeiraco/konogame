import { dirname, join, relative, resolve, sep } from "node:path";
import { Effect } from "effect";
import { DevCliError } from "../context.ts";
import { canonicalPath, follow, listNames, pathExists, readText } from "../files.ts";
import { repositoryRoot } from "../repository.ts";

function markdownFiles(directory: string): Effect.Effect<string[], DevCliError> {
  return Effect.gen(function* () {
    const names = yield* listNames(directory);
    const nested = yield* Effect.forEach(
      names,
      (name) =>
        Effect.gen(function* () {
          const path = join(directory, name);
          if ((yield* follow(path)).isDirectory()) {
            return yield* markdownFiles(path);
          }
          return name.endsWith(".md") ? [path] : [];
        }),
      { concurrency: "unbounded" }
    );
    return nested.flat();
  });
}

export function checkDocs(base = repositoryRoot()) {
  return Effect.gen(function* () {
    const discovered = [
      resolve(base, "README.md"),
      resolve(base, "AGENTS.md"),
      ...(yield* markdownFiles(resolve(base, "docs/en"))),
      ...(yield* markdownFiles(resolve(base, "docs/zh")))
    ];
    // Relative links in a projection belong to its canonical source, checked once.
    const files = new Set(
      yield* Effect.forEach(discovered, (file) => canonicalPath(file), {
        concurrency: "unbounded"
      })
    );
    const errors = (yield* Effect.forEach(
      files,
      (file) =>
        Effect.gen(function* () {
          const name = relative(base, file).split(sep).join("/");
          const source = yield* readText(file);
          const found: string[] = [];
          if (
            name !== "AGENTS.md" &&
            !name.includes("/archive/") &&
            !(source.includes("[English](") && source.includes("[中文]("))
          ) {
            found.push(`${name}: missing language links`);
          }
          const targets = [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].flatMap((match) => {
            const target = match[1]?.split("#")[0];
            return !target || /^[a-z]+:/i.test(target) ? [] : [target];
          });
          const missing = yield* Effect.forEach(
            targets,
            (target) =>
              pathExists(resolve(dirname(file), decodeURIComponent(target))).pipe(
                Effect.map((exists) => (exists ? undefined : `${name}: missing ${target}`))
              ),
            { concurrency: "unbounded" }
          );
          return [...found, ...missing.filter((item) => item !== undefined)];
        }),
      { concurrency: "unbounded" }
    )).flat();
    if (errors.length) {
      return yield* Effect.fail(new DevCliError({ message: errors.join("\n") }));
    }
    return { documents: files.size };
  });
}
