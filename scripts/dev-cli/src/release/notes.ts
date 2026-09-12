import { Effect } from "effect";
import semver from "semver";
import { checked, DevCliError } from "../context.ts";
import { readText } from "../files.ts";
import { repositoryRoot } from "../repository.ts";
import { loadMetadata, pathInRepository } from "./metadata.ts";

export function releaseNotes(
  changelog: string,
  releaseVersion: string,
  extensionId?: string
): string {
  if (semver.valid(releaseVersion) !== releaseVersion) {
    throw new Error("Expected an exact SemVer version");
  }
  const title = extensionId === undefined ? releaseVersion : `${extensionId}@${releaseVersion}`;
  const lines = changelog.split(/\r?\n/);
  const indices = lines.flatMap((line, index) =>
    line === `## ${title}` || line.startsWith(`## ${title} - `) ? [index] : []
  );
  if (indices.length !== 1) {
    throw new Error(`Expected one exact changelog section: ${title}`);
  }
  const start = indices[0]! + 1;
  const end = lines.findIndex((line, index) => index >= start && line.startsWith("## "));
  const body = lines
    .slice(start, end < 0 ? undefined : end)
    .filter((line) => !line.startsWith("[English]("))
    .join("\n")
    .trim();
  if (!body?.split("\n").some((line) => line.startsWith("- "))) {
    throw new Error(`Changelog section has no release notes: ${title}`);
  }
  return body;
}

export function notesForRelease(
  options: { root?: string; language?: string; version?: string; extensionId?: string } = {}
) {
  return Effect.gen(function* () {
    const root = options.root ?? repositoryRoot();
    const metadata = yield* loadMetadata(root);
    const extension =
      options.extensionId === undefined
        ? undefined
        : metadata.extension.find((item) => item.id === options.extensionId);
    if (options.extensionId !== undefined && !extension) {
      return yield* Effect.fail(
        new DevCliError({ message: `Unknown Extension: ${options.extensionId}` })
      );
    }
    const path =
      options.language === undefined || options.language === "en"
        ? metadata.release.changelog
        : metadata.release.translations[options.language];
    if (!path) {
      return yield* Effect.fail(
        new DevCliError({ message: `Unknown changelog language: ${options.language}` })
      );
    }
    const source = yield* readText(yield* pathInRepository(root, path));
    return yield* checked(() =>
      releaseNotes(
        source,
        options.version ?? extension?.version ?? metadata.project.version,
        options.extensionId
      )
    );
  });
}
