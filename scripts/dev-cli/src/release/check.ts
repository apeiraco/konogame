import { isAbsolute, join } from "node:path";
import { Effect, Fiber } from "effect";
import { DevCliError } from "../context.ts";
import {
  canonicalPath,
  inspect,
  linkTarget,
  listNamesOptional,
  readTextOptional
} from "../files.ts";
import { repositoryRoot } from "../repository.ts";
import { releaseEdits } from "./edits.ts";
import { loadMetadata, pathInRepository } from "./metadata.ts";
import { notesForRelease } from "./notes.ts";

export function checkRelease(root = repositoryRoot()) {
  return Effect.gen(function* () {
    const metadata = yield* loadMetadata(root);
    const declared = [
      ...metadata.core_package.map((item) => item.manifest),
      ...metadata.extension.map((item) => item.manifest)
    ].sort();
    const discovered = yield* Effect.forEach(
      ["apps", "packages", "extensions", "scripts"],
      (directory) =>
        Effect.gen(function* () {
          const children = yield* listNamesOptional(join(root, directory));
          return yield* Effect.forEach(
            children,
            (child) =>
              Effect.gen(function* () {
                const info = yield* inspect(join(root, directory, child));
                if (
                  info.isDirectory() &&
                  (yield* readTextOptional(join(root, directory, child, "package.json"))) !== null
                ) {
                  return `${directory}/${child}/package.json`;
                }
                return undefined;
              }),
            { concurrency: "unbounded" }
          );
        }),
      { concurrency: "unbounded" }
    );
    const actual = ["package.json", ...discovered.flat().filter((item) => item !== undefined)];
    if (JSON.stringify(actual.sort()) !== JSON.stringify(declared)) {
      return yield* Effect.fail(
        new DevCliError({
          message:
            "Metadata inventory differs from workspace manifests; register every core package and Extension"
        })
      );
    }
    const edits = yield* releaseEdits(root, metadata);
    if (edits.length) {
      return yield* Effect.fail(
        new DevCliError({
          message: `Release metadata drift; run dev-cli release sync: ${edits.map((edit) => edit.path).join(", ")}`
        })
      );
    }
    const canonical = yield* pathInRepository(root, metadata.release.changelog);
    const projection = join(root, "docs/en/CHANGELOG.md");
    const linkStat = yield* inspect(projection);
    if (!linkStat.isSymbolicLink()) {
      return yield* Effect.fail(
        new DevCliError({
          message:
            "English CHANGELOG must be a relative symlink projection of its canonical root source"
        })
      );
    }
    const [linkTargetPath, projectionReal, canonicalReal] = yield* Effect.all(
      [linkTarget(projection), canonicalPath(projection), canonicalPath(canonical)],
      { concurrency: "unbounded" }
    );
    if (isAbsolute(linkTargetPath) || projectionReal !== canonicalReal) {
      return yield* Effect.fail(
        new DevCliError({
          message:
            "English CHANGELOG must be a relative symlink projection of its canonical root source"
        })
      );
    }
    const languages = ["en", ...Object.keys(metadata.release.translations)];
    const noteTasks = languages.flatMap((language) => [
      notesForRelease({ root, language }),
      ...metadata.extension.map((extension) =>
        notesForRelease({ root, language, extensionId: extension.id })
      )
    ]);
    // Fork on this fiber. A completed collector would interrupt the children before they are joined.
    const fibers = [];
    for (const task of noteTasks) {
      fibers.push(yield* Effect.forkChild(task));
    }
    yield* Fiber.joinAll(fibers);
    return {
      version: metadata.project.version,
      declarationProtocolVersion: metadata.declaration_protocol.version,
      ports: metadata.port.map(({ id, version, supported_range }) => ({
        id,
        version,
        supportedRange: supported_range
      })),
      corePackages: metadata.core_package.length,
      extensions: metadata.extension.length,
      languages
    };
  });
}
