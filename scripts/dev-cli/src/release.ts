import { randomBytes } from "node:crypto";
import { type Dirent } from "node:fs";
import {
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import semver from "semver";
import { parse } from "smol-toml";
import { parseTOML } from "toml-eslint-parser";
import * as z from "zod";
import { repositoryRoot } from "./docs.ts";

export const METADATA_FILE = "konogame-metadata.toml";
export const SoftwareVersion = { Latest: "latest", Generic: "generic" } as const;
export type SoftwareVersion = (typeof SoftwareVersion)[keyof typeof SoftwareVersion];
const text = z.string().min(1);
const version = text.refine(
  (value) => semver.valid(value) === value,
  "Expected an exact SemVer version"
);
const range = text.refine((value) => semver.validRange(value) !== null, "Expected a SemVer range");
const softwareVersion = text.refine(
  (value) =>
    Object.values(SoftwareVersion).some((marker) => marker === value) ||
    semver.validRange(value) !== null,
  "Expected a SemVer range, latest, or generic"
);
const managedPackage = { name: text, manifest: text };

export const metadataSchema = z.strictObject({
  schema_version: z.literal(1),
  project: z.strictObject({
    name: text,
    display_name: text,
    version,
    description: text,
    license: text,
    repository_url: z.url()
  }),
  contract: z.strictObject({ version, supported_range: range, package: text, source: text }),
  tooling: z.strictObject({ typescript: z.strictObject({ config: text }) }),
  release: z.strictObject({
    tag_prefix: text,
    changelog: text,
    translations: z
      .record(text, text)
      .refine((value) => Object.hasOwn(value, "zh"), "Chinese changelog is required")
  }),
  core_package: z.array(z.strictObject(managedPackage)).min(1),
  extension: z.array(
    z.strictObject({
      id: text,
      package: text,
      manifest: text,
      version,
      contract_range: range,
      source: text,
      software: z.record(text, softwareVersion)
    })
  )
});
export type ProjectMetadata = z.infer<typeof metadataSchema>;
export interface ReleaseEdit {
  path: string;
  before: string | null;
  after: string;
}

export function parseMetadata(source: string): ProjectMetadata {
  parseTOML(source, { tomlVersion: "1.0" });
  const metadata = metadataSchema.parse(parse(source));
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
  };
  unique(
    [
      ...metadata.core_package.map((item) => item.name),
      ...metadata.extension.map((item) => item.package)
    ],
    "package name"
  );
  unique(
    [
      ...metadata.core_package.map((item) => item.manifest),
      ...metadata.extension.map((item) => item.manifest)
    ],
    "manifest path"
  );
  unique(
    metadata.extension.map((item) => item.id),
    "Extension ID"
  );
  unique(
    [metadata.contract.source, ...metadata.extension.map((item) => item.source)],
    "generated source path"
  );
  unique(
    [metadata.release.changelog, ...Object.values(metadata.release.translations)],
    "changelog path"
  );
  if (Object.hasOwn(metadata.release.translations, "en"))
    throw new Error("English changelog must use its canonical root source");
  if (
    metadata.release.changelog !== "CHANGELOG.md" ||
    Object.entries(metadata.release.translations).some(
      ([language, path]) =>
        !/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(language) || path !== `docs/${language}/CHANGELOG.md`
    )
  )
    throw new Error("Changelogs must follow the canonical root and docs/{lang} layout");
  if (
    !metadata.core_package.some(
      (item) => item.manifest === "package.json" && item.name === metadata.project.name
    )
  )
    throw new Error("Project root manifest must belong to core");
  if (!metadata.core_package.some((item) => item.name === metadata.contract.package))
    throw new Error("Contract package must belong to core");
  if (!semver.satisfies(metadata.contract.version, metadata.contract.supported_range))
    throw new Error("Core Contract range excludes the current protocol version");
  for (const extension of metadata.extension) {
    if (!semver.satisfies(metadata.contract.version, extension.contract_range))
      throw new Error(
        `Extension Contract range excludes the current protocol version: ${extension.id}`
      );
    if (
      !extension.manifest.startsWith("extensions/") ||
      extension.source !== `${dirname(extension.manifest).replaceAll("\\", "/")}/src/metadata.ts`
    )
      throw new Error(`Invalid Extension manifest/source layout: ${extension.id}`);
  }
  const contract = metadata.core_package.find((item) => item.name === metadata.contract.package)!;
  if (
    metadata.contract.source !==
    `${dirname(contract.manifest).replaceAll("\\", "/")}/src/version.ts`
  )
    throw new Error("Invalid Contract version source layout");
  return metadata;
}

async function pathInRepository(root: string, path: string): Promise<string> {
  const base = resolve(root);
  const target = resolve(base, path);
  const rel = relative(base, target);
  if (isAbsolute(path) || !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Expected a repository-relative path: ${path}`);
  let current = base;
  for (const component of rel.split(sep)) {
    current = join(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Release paths cannot be symlinks: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return target;
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function loadMetadata(root = repositoryRoot()): Promise<ProjectMetadata> {
  return parseMetadata(await readFile(await pathInRepository(root, METADATA_FILE), "utf8"));
}
function newlines(source: string | null, next: string): string {
  return source?.includes("\r\n") ? next.replaceAll("\n", "\r\n") : next;
}
const generatedHeader = "// Generated from konogame-metadata.toml by dev-cli release sync.\n";
function coreSource(metadata: ProjectMetadata): string {
  return (
    generatedHeader +
    `export const CORE_VERSION = ${JSON.stringify(metadata.project.version)};\nexport const CONTRACT_VERSION = ${JSON.stringify(metadata.contract.version)};\nexport const CORE_CONTRACT_RANGE = ${JSON.stringify(metadata.contract.supported_range)};\n`
  );
}
function extensionSource(extension: ProjectMetadata["extension"][number]): string {
  const info = {
    id: extension.id,
    version: extension.version,
    contractRange: extension.contract_range,
    software: extension.software
  };
  return (
    generatedHeader +
    `export const extensionMetadata = ${JSON.stringify(info, null, 2)} as const;\n`
  );
}

export async function releaseEdits(
  root: string,
  metadata: ProjectMetadata,
  extensionId?: string
): Promise<ReleaseEdit[]> {
  if (extensionId !== undefined && !metadata.extension.some((item) => item.id === extensionId))
    throw new Error(`Unknown Extension: ${extensionId}`);
  const edits: ReleaseEdit[] = [];
  const record = async (path: string, content: string) => {
    const before = await readOptional(await pathInRepository(root, path));
    edits.push({ path, before, after: newlines(before, content) });
  };
  const packages = [
    ...(extensionId === undefined
      ? metadata.core_package.map((item) => ({
          ...item,
          version: metadata.project.version,
          compatibility: { releaseGroup: "core", contractRange: metadata.contract.supported_range }
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
          contractRange: item.contract_range,
          software: item.software
        }
      }))
  ];
  for (const item of packages) {
    const source = await readFile(await pathInRepository(root, item.manifest), "utf8");
    const manifest = JSON.parse(source);
    if (manifest.name !== item.name) throw new Error(`Package name mismatch: ${item.manifest}`);
    manifest.version = item.version;
    manifest.license = metadata.project.license;
    manifest.repository = {
      type: "git",
      url: `${metadata.project.repository_url.replace(/\.git$/, "")}.git`
    };
    manifest.konogame = item.compatibility;
    if (item.manifest === "package.json") manifest.description = metadata.project.description;
    await record(item.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  if (extensionId === undefined) await record(metadata.contract.source, coreSource(metadata));
  for (const extension of metadata.extension.filter(
    (item) => extensionId === undefined || item.id === extensionId
  ))
    await record(extension.source, extensionSource(extension));
  return edits.filter((edit) => edit.before !== edit.after);
}

async function applyEdits(root: string, edits: ReleaseEdit[]): Promise<void> {
  for (const edit of edits)
    if ((await readOptional(await pathInRepository(root, edit.path))) !== edit.before)
      throw new Error(`Release file changed during preparation: ${edit.path}`);
  const committed: ReleaseEdit[] = [];
  const token = randomBytes(8).toString("hex");
  try {
    for (const edit of edits) {
      const target = await pathInRepository(root, edit.path);
      const temporary = `${target}.release-${token}.tmp`;
      let writeFailed = false;
      let writeError: unknown;
      try {
        await writeFile(temporary, edit.after, { flag: "wx" });
        if ((await readOptional(target)) !== edit.before)
          throw new Error(`Release file changed before replacement: ${edit.path}`);
        await rename(temporary, target);
        committed.push(edit);
      } catch (error) {
        writeFailed = true;
        writeError = error;
      }
      try {
        await unlink(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          // Keep both failures so cleanup cannot hide the failed write during rollback.
          if (writeFailed)
            throw new AggregateError([writeError, error], "Release write and cleanup failed");
          throw error;
        }
      }
      if (writeFailed) throw writeError;
    }
  } catch (error) {
    const conflicts: string[] = [];
    for (const edit of committed.reverse()) {
      const target = await pathInRepository(root, edit.path);
      if ((await readOptional(target)) !== edit.after) {
        conflicts.push(edit.path);
        continue;
      }
      if (edit.before === null) await unlink(target);
      else await writeFile(target, edit.before);
    }
    if (conflicts.length)
      throw new Error(
        `Release update failed; preserve external edits and recover manually: ${conflicts.join(", ")}`,
        { cause: error }
      );
    throw error;
  }
}

export async function syncRelease(root = repositoryRoot(), dryRun = false) {
  const metadata = await loadMetadata(root);
  const edits = await releaseEdits(root, metadata);
  if (!dryRun) await applyEdits(root, edits);
  return { version: metadata.project.version, dryRun, changed: edits.map((edit) => edit.path) };
}

function replaceVersion(
  source: string,
  metadata: ProjectMetadata,
  next: string,
  extensionId?: string
): string {
  if (semver.valid(next) !== next) throw new Error(`Expected an exact SemVer version: ${next}`);
  const ast = parseTOML(source, { tomlVersion: "1.0" });
  const expected =
    extensionId === undefined
      ? ["project"]
      : ["extension", metadata.extension.findIndex((item) => item.id === extensionId)];
  const table = ast.body[0].body.find(
    (entry) =>
      entry.type === "TOMLTable" && JSON.stringify(entry.resolvedKey) === JSON.stringify(expected)
  );
  if (table?.type !== "TOMLTable")
    throw new Error(`Unknown release group: ${extensionId ?? "core"}`);
  const field = table.body.find(
    (pair) =>
      pair.key.keys.length === 1 &&
      (pair.key.keys[0]!.type === "TOMLBare" ? pair.key.keys[0]!.name : pair.key.keys[0]!.value) ===
        "version"
  );
  if (!field) throw new Error("Missing metadata version field");
  return (
    source.slice(0, field.value.range[0]) +
    JSON.stringify(next) +
    source.slice(field.value.range[1])
  );
}

export async function setReleaseVersion(
  next: string,
  options: { root?: string; extensionId?: string; dryRun?: boolean } = {}
) {
  const root = options.root ?? repositoryRoot();
  const before = await readFile(await pathInRepository(root, METADATA_FILE), "utf8");
  const current = parseMetadata(before);
  if (
    options.extensionId !== undefined &&
    !current.extension.some((item) => item.id === options.extensionId)
  )
    throw new Error(`Unknown Extension: ${options.extensionId}`);
  const after = replaceVersion(before, current, next, options.extensionId);
  const metadata = parseMetadata(after);
  let edits = await releaseEdits(root, metadata, options.extensionId);
  // A core version update must not repair or change an independently released Extension.
  if (options.extensionId === undefined) {
    const extensionPaths = new Set(
      metadata.extension.flatMap((item) => [item.manifest, item.source])
    );
    edits = edits.filter((edit) => !extensionPaths.has(edit.path));
  }
  if (before !== after) edits.push({ path: METADATA_FILE, before, after });
  if (!options.dryRun) await applyEdits(root, edits);
  return {
    group: options.extensionId ?? "core",
    version: next,
    dryRun: options.dryRun ?? false,
    changed: edits.map((edit) => edit.path)
  };
}

export function releaseNotes(
  changelog: string,
  releaseVersion: string,
  extensionId?: string
): string {
  if (semver.valid(releaseVersion) !== releaseVersion)
    throw new Error("Expected an exact SemVer version");
  const title = extensionId === undefined ? releaseVersion : `${extensionId}@${releaseVersion}`;
  const lines = changelog.split(/\r?\n/);
  const indices = lines.flatMap((line, index) =>
    line === `## ${title}` || line.startsWith(`## ${title} - `) ? [index] : []
  );
  if (indices.length !== 1) throw new Error(`Expected one exact changelog section: ${title}`);
  const start = indices[0]! + 1;
  const end = lines.findIndex((line, index) => index >= start && line.startsWith("## "));
  const body = lines
    .slice(start, end < 0 ? undefined : end)
    .filter((line) => !line.startsWith("[English]("))
    .join("\n")
    .trim();
  if (!body?.split("\n").some((line) => line.startsWith("- ")))
    throw new Error(`Changelog section has no release notes: ${title}`);
  return body;
}

export async function notesForRelease(
  options: { root?: string; language?: string; version?: string; extensionId?: string } = {}
) {
  const root = options.root ?? repositoryRoot();
  const metadata = await loadMetadata(root);
  const extension =
    options.extensionId === undefined
      ? undefined
      : metadata.extension.find((item) => item.id === options.extensionId);
  if (options.extensionId !== undefined && !extension)
    throw new Error(`Unknown Extension: ${options.extensionId}`);
  const path =
    options.language === undefined || options.language === "en"
      ? metadata.release.changelog
      : metadata.release.translations[options.language];
  if (!path) throw new Error(`Unknown changelog language: ${options.language}`);
  return releaseNotes(
    await readFile(await pathInRepository(root, path), "utf8"),
    options.version ?? extension?.version ?? metadata.project.version,
    options.extensionId
  );
}

export async function checkRelease(root = repositoryRoot()) {
  const metadata = await loadMetadata(root);
  const declared = [
    metadata.core_package.map((item) => item.manifest),
    metadata.extension.map((item) => item.manifest)
  ]
    .flat()
    .sort();
  const actual = ["package.json"];
  for (const directory of ["apps", "packages", "extensions", "scripts"]) {
    let children: Dirent[];
    try {
      children = await readdir(join(root, directory), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const child of children)
      if (
        child.isDirectory() &&
        (await readOptional(join(root, directory, child.name, "package.json"))) !== null
      )
        actual.push(`${directory}/${child.name}/package.json`);
  }
  if (JSON.stringify(actual.sort()) !== JSON.stringify(declared))
    throw new Error(
      "Metadata inventory differs from workspace manifests; register every core package and Extension"
    );
  const edits = await releaseEdits(root, metadata);
  if (edits.length)
    throw new Error(
      `Release metadata drift; run dev-cli release sync: ${edits.map((edit) => edit.path).join(", ")}`
    );
  const canonical = await pathInRepository(root, metadata.release.changelog);
  const projection = join(root, "docs/en/CHANGELOG.md");
  if (
    !(await lstat(projection)).isSymbolicLink() ||
    isAbsolute(await readlink(projection)) ||
    (await realpath(projection)) !== (await realpath(canonical))
  )
    throw new Error(
      "English CHANGELOG must be a relative symlink projection of its canonical root source"
    );
  const languages = ["en", ...Object.keys(metadata.release.translations)];
  for (const language of languages) {
    await notesForRelease({ root, language });
    for (const extension of metadata.extension)
      await notesForRelease({ root, language, extensionId: extension.id });
  }
  return {
    version: metadata.project.version,
    contractVersion: metadata.contract.version,
    corePackages: metadata.core_package.length,
    extensions: metadata.extension.length,
    languages
  };
}
