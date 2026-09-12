import { randomBytes } from "node:crypto";
import { Effect } from "effect";
import { checked, DevCliError } from "../context.ts";
import {
  movePath,
  readText,
  readTextOptional,
  removePath,
  writeNewText,
  writeText
} from "../files.ts";
import { type ProjectMetadata, pathInRepository } from "./metadata.ts";

export interface ReleaseEdit {
  path: string;
  before: string | null;
  after: string;
}

function newlines(source: string | null, next: string): string {
  return source?.includes("\r\n") ? next.replaceAll("\n", "\r\n") : next;
}
const generatedHeader = "// Generated from konogame-metadata.toml by dev-cli release sync.\n";
function coreSource(metadata: ProjectMetadata): string {
  return (
    generatedHeader +
    `export const CORE_VERSION = ${JSON.stringify(metadata.project.version)};\nexport const DECLARATION_PROTOCOL_VERSION = ${JSON.stringify(metadata.declaration_protocol.version)};\nexport const DECLARATION_PROTOCOL_RANGE = ${JSON.stringify(metadata.declaration_protocol.supported_range)};\n`
  );
}
function portSource(ports: ProjectMetadata["port"]): string {
  return (
    generatedHeader +
    ports
      .map((port) => {
        const name = `${port.id.replaceAll(/[.-]/g, "_").toUpperCase()}_PORT`;
        return `export const ${name} = ${JSON.stringify({ version: port.version, supportedRange: port.supported_range }, null, 2)} as const;\n`;
      })
      .join("")
  );
}
function extensionSource(extension: ProjectMetadata["extension"][number]): string {
  const info = {
    id: extension.id,
    version: extension.version,
    declarationProtocolRange: extension.declaration_protocol_range,
    software: extension.software
  };
  return (
    generatedHeader +
    `export const extensionMetadata = ${JSON.stringify(info, null, 2)} as const;\n` +
    `export const adapterPortVersionRanges = ${JSON.stringify(extension.port_version_ranges, null, 2)} as const;\n`
  );
}

export function releaseEdits(root: string, metadata: ProjectMetadata, extensionId?: string) {
  return Effect.gen(function* () {
    if (extensionId !== undefined && !metadata.extension.some((item) => item.id === extensionId)) {
      return yield* Effect.fail(new DevCliError({ message: `Unknown Extension: ${extensionId}` }));
    }
    const edits: ReleaseEdit[] = [];
    const record = (path: string, content: string) =>
      Effect.gen(function* () {
        const before = yield* readTextOptional(yield* pathInRepository(root, path));
        edits.push({ path, before, after: newlines(before, content) });
      });
    const packages = [
      ...(extensionId === undefined
        ? metadata.core_package.map((item) => ({
            ...item,
            version: metadata.project.version,
            compatibility: {
              releaseGroup: "core",
              declarationProtocolRange: metadata.declaration_protocol.supported_range
            }
          }))
        : []),
      ...metadata.extension
        .filter((item) => extensionId === undefined || item.id === extensionId)
        .map((item) => ({
          name: item.package,
          manifest: item.manifest,
          version: item.version,
          compatibility: {
            releaseGroup: "extension",
            extensionId: item.id,
            declarationProtocolRange: item.declaration_protocol_range,
            portVersionRanges: item.port_version_ranges,
            software: item.software
          }
        }))
    ];
    const packageEdits = yield* Effect.forEach(
      packages,
      (item) =>
        Effect.gen(function* () {
          const located = yield* pathInRepository(root, item.manifest);
          const text = yield* readText(located);
          const manifest = yield* checked(() => JSON.parse(text));
          if (manifest.name !== item.name) {
            return yield* Effect.fail(
              new DevCliError({ message: `Package name mismatch: ${item.manifest}` })
            );
          }
          manifest.version = item.version;
          manifest.license = metadata.project.license;
          manifest.repository = {
            type: "git",
            url: `${metadata.project.repository_url.replace(/\.git$/, "")}.git`
          };
          manifest.konogame = item.compatibility;
          if (item.manifest === "package.json") {
            manifest.description = metadata.project.description;
          }
          const before = yield* readTextOptional(located);
          const after = newlines(before, `${JSON.stringify(manifest, null, 2)}\n`);
          return { path: item.manifest, before, after };
        }),
      { concurrency: "unbounded" }
    );
    edits.push(...packageEdits);
    if (extensionId === undefined) {
      yield* record(metadata.declaration_protocol.source, coreSource(metadata));
      const sources = new Set(metadata.port.map((port) => port.source));
      for (const source of sources) {
        yield* record(source, portSource(metadata.port.filter((port) => port.source === source)));
      }
    }
    for (const extension of metadata.extension.filter(
      (item) => extensionId === undefined || item.id === extensionId
    )) {
      yield* record(extension.source, extensionSource(extension));
    }
    return edits.filter((edit) => edit.before !== edit.after);
  });
}

export function applyEdits(root: string, edits: ReleaseEdit[]) {
  return Effect.gen(function* () {
    for (const edit of edits) {
      if ((yield* readTextOptional(yield* pathInRepository(root, edit.path))) !== edit.before) {
        return yield* Effect.fail(
          new DevCliError({ message: `Release file changed during preparation: ${edit.path}` })
        );
      }
    }
    const committed: ReleaseEdit[] = [];
    const token = yield* checked(() => randomBytes(8).toString("hex"));
    const write = Effect.gen(function* () {
      for (const edit of edits) {
        const target = yield* pathInRepository(root, edit.path);
        const temporary = `${target}.release-${token}.tmp`;
        yield* Effect.acquireUseRelease(
          writeNewText(temporary, edit.after),
          () =>
            Effect.gen(function* () {
              if ((yield* readTextOptional(target)) !== edit.before) {
                return yield* Effect.fail(
                  new DevCliError({
                    message: `Release file changed before replacement: ${edit.path}`
                  })
                );
              }
              yield* movePath(temporary, target);
              committed.push(edit);
            }),
          () => removePath(temporary).pipe(Effect.orDie)
        );
      }
    });
    // Rollback is part of the interrupted write scope so an interruption cannot skip it.
    yield* write.pipe(
      Effect.onExit((exit) => {
        if (exit._tag === "Success") {
          return Effect.void;
        }
        return Effect.gen(function* () {
          const conflicts: string[] = [];
          for (const edit of committed.toReversed()) {
            const target = yield* pathInRepository(root, edit.path);
            if ((yield* readTextOptional(target)) !== edit.after) {
              conflicts.push(edit.path);
              continue;
            }
            if (edit.before === null) {
              yield* removePath(target);
            } else {
              yield* writeText(target, edit.before);
            }
          }
          if (conflicts.length) {
            return yield* Effect.die(
              new DevCliError({
                message: `Release update failed; preserve external edits and recover manually: ${conflicts.join(", ")}`,
                cause: exit.cause
              })
            );
          }
        }).pipe(Effect.orDie);
      })
    );
  });
}
