import { Effect } from "effect";
import semver from "semver";
import { parseTOML } from "toml-eslint-parser";
import { checked, DevCliError } from "../context.ts";
import { readText } from "../files.ts";
import { repositoryRoot } from "../repository.ts";
import { applyEdits, releaseEdits } from "./edits.ts";
import {
  METADATA_FILE,
  type ProjectMetadata,
  parseMetadata,
  pathInRepository
} from "./metadata.ts";

function replaceVersion(
  source: string,
  metadata: ProjectMetadata,
  next: string,
  extensionId?: string
): string {
  if (semver.valid(next) !== next) {
    throw new Error(`Expected an exact SemVer version: ${next}`);
  }
  const ast = parseTOML(source, { tomlVersion: "1.0" });
  const expected =
    extensionId === undefined
      ? ["project"]
      : ["extension", metadata.extension.findIndex((item) => item.id === extensionId)];
  const table = ast.body[0].body.find(
    (entry) =>
      entry.type === "TOMLTable" && JSON.stringify(entry.resolvedKey) === JSON.stringify(expected)
  );
  if (table?.type !== "TOMLTable") {
    throw new Error(`Unknown release group: ${extensionId ?? "core"}`);
  }
  const field = table.body.find(
    (pair) =>
      pair.key.keys.length === 1 &&
      (pair.key.keys[0]!.type === "TOMLBare" ? pair.key.keys[0]!.name : pair.key.keys[0]!.value) ===
        "version"
  );
  if (!field) {
    throw new Error("Missing metadata version field");
  }
  return (
    source.slice(0, field.value.range[0]) +
    JSON.stringify(next) +
    source.slice(field.value.range[1])
  );
}

export function setReleaseVersion(
  next: string,
  options: { root?: string; extensionId?: string; dryRun?: boolean } = {}
) {
  return Effect.gen(function* () {
    const root = options.root ?? repositoryRoot();
    const before = yield* readText(yield* pathInRepository(root, METADATA_FILE));
    const current = yield* checked(() => parseMetadata(before));
    if (
      options.extensionId !== undefined &&
      !current.extension.some((item) => item.id === options.extensionId)
    ) {
      return yield* Effect.fail(
        new DevCliError({ message: `Unknown Extension: ${options.extensionId}` })
      );
    }
    const after = yield* checked(() => replaceVersion(before, current, next, options.extensionId));
    const metadata = yield* checked(() => parseMetadata(after));
    let edits = yield* releaseEdits(root, metadata, options.extensionId);
    if (options.extensionId === undefined) {
      const extensionPaths = new Set(
        metadata.extension.flatMap((item) => [item.manifest, item.source])
      );
      edits = edits.filter((edit) => !extensionPaths.has(edit.path));
    }
    if (before !== after) {
      edits.push({ path: METADATA_FILE, before, after });
    }
    if (!options.dryRun) {
      yield* applyEdits(root, edits);
    }
    return {
      group: options.extensionId ?? "core",
      version: next,
      dryRun: options.dryRun ?? false,
      changed: edits.map((edit) => edit.path)
    };
  });
}
