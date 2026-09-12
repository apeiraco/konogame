import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type } from "arktype";
import { Effect } from "effect";
import semver from "semver";
import { parse } from "smol-toml";
import { parseTOML } from "toml-eslint-parser";
import { checked, DevCliError } from "../context.ts";
import { inspectOptional, readText } from "../files.ts";
import { repositoryRoot } from "../repository.ts";

export const METADATA_FILE = "konogame-metadata.toml";
export const SoftwareVersion = { Latest: "latest", Generic: "generic" } as const;
export type SoftwareVersion = (typeof SoftwareVersion)[keyof typeof SoftwareVersion];
const text = type.string.atLeastLength(1);
const version = text.narrow(
  (value, ctx) => semver.valid(value) === value || ctx.mustBe("an exact SemVer version")
);
const range = text.narrow(
  (value, ctx) => semver.validRange(value) !== null || ctx.mustBe("a SemVer range")
);
const softwareVersion = text.narrow(
  (value, ctx) =>
    Object.values(SoftwareVersion).some((marker) => marker === value) ||
    semver.validRange(value) !== null ||
    ctx.mustBe("a SemVer range, latest, or generic")
);
const managedPackage = type({ "+": "reject", name: text, manifest: text });

export const metadataSchema = type({
  "+": "reject",
  schema_version: type.unit(1),
  project: type({
    "+": "reject",
    name: text,
    display_name: text,
    version,
    description: text,
    license: text,
    repository_url: type("string.url")
  }),
  declaration_protocol: type({
    "+": "reject",
    version,
    supported_range: range,
    package: text,
    source: text
  }),
  port: type({
    "+": "reject",
    id: text,
    version,
    supported_range: range,
    package: text,
    source: text
  })
    .array()
    .atLeastLength(1),
  tooling: type({ "+": "reject", typescript: type({ "+": "reject", config: text }) }),
  release: type({
    "+": "reject",
    tag_prefix: text,
    changelog: text,
    translations: type({ "+": "reject", "[/.+/]": text }).narrow(
      (value, ctx) => Object.hasOwn(value, "zh") || ctx.mustBe("a Chinese changelog")
    )
  }),
  core_package: managedPackage.array().atLeastLength(1),
  extension: type({
    "+": "reject",
    id: text,
    package: text,
    manifest: text,
    version,
    declaration_protocol_range: range,
    port_version_ranges: type({ "+": "reject", "[/.+/]": range }),
    source: text,
    software: type({ "+": "reject", "[/.+/]": softwareVersion })
  }).array()
}).onDeepUndeclaredKey("reject");
export type ProjectMetadata = (typeof metadataSchema)["infer"];

export function parseMetadata(source: string): ProjectMetadata {
  parseTOML(source, { tomlVersion: "1.0" });
  const metadata = metadataSchema.assert(parse(source));
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) {
      throw new Error(`Duplicate ${label}`);
    }
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
    metadata.port.map((item) => item.id),
    "Port ID"
  );
  unique(
    metadata.port.map((item) => item.id.replaceAll(/[.-]/g, "_").toUpperCase()),
    "Port constant"
  );
  unique(
    [metadata.declaration_protocol.source, ...metadata.extension.map((item) => item.source)],
    "generated source path"
  );
  unique(
    [metadata.release.changelog, ...Object.values(metadata.release.translations)],
    "changelog path"
  );
  if (Object.hasOwn(metadata.release.translations, "en")) {
    throw new Error("English changelog must use its canonical root source");
  }
  if (
    metadata.release.changelog !== "CHANGELOG.md" ||
    Object.entries(metadata.release.translations).some(
      ([language, path]) =>
        !/^[a-z]{2}(?:-[a-z0-9]+)*$/.test(language) || path !== `docs/${language}/CHANGELOG.md`
    )
  ) {
    throw new Error("Changelogs must follow the canonical root and docs/{lang} layout");
  }
  if (
    !metadata.core_package.some(
      (item) => item.manifest === "package.json" && item.name === metadata.project.name
    )
  ) {
    throw new Error("Project root manifest must belong to core");
  }
  if (!metadata.core_package.some((item) => item.name === metadata.declaration_protocol.package)) {
    throw new Error("Declaration protocol package must belong to core");
  }
  if (
    !semver.satisfies(
      metadata.declaration_protocol.version,
      metadata.declaration_protocol.supported_range
    )
  ) {
    throw new Error("Declaration protocol range excludes the current protocol version");
  }
  for (const extension of metadata.extension) {
    if (
      !semver.satisfies(metadata.declaration_protocol.version, extension.declaration_protocol_range)
    ) {
      throw new Error(
        `Extension declaration protocol range excludes the current protocol version: ${extension.id}`
      );
    }
    if (
      !extension.manifest.startsWith("extensions/") ||
      extension.source !== `${dirname(extension.manifest).replaceAll("\\", "/")}/src/metadata.ts`
    ) {
      throw new Error(`Invalid Extension manifest/source layout: ${extension.id}`);
    }
  }
  const declarationProtocol = metadata.core_package.find(
    (item) => item.name === metadata.declaration_protocol.package
  )!;
  if (
    metadata.declaration_protocol.source !==
    `${dirname(declarationProtocol.manifest).replaceAll("\\", "/")}/src/contracts/version.ts`
  ) {
    throw new Error("Invalid declaration protocol version source layout");
  }
  const sources = new Map<string, string>();
  for (const port of metadata.port) {
    const owner = metadata.core_package.find((item) => item.name === port.package);
    if (!owner) {
      throw new Error(`Port package must belong to core: ${port.id}`);
    }
    if (!semver.satisfies(port.version, port.supported_range)) {
      throw new Error(`Port range excludes its version: ${port.id}`);
    }
    const base = dirname(owner.manifest).replaceAll("\\", "/");
    const expected =
      port.package === metadata.declaration_protocol.package
        ? `${base}/src/contracts/port-versions.ts`
        : `${base}/src/version.ts`;
    if (port.source !== expected) {
      throw new Error(`Invalid Port source layout: ${port.id}`);
    }
    const previous = sources.get(port.source);
    if (previous && previous !== port.package) {
      throw new Error(`Conflicting Port source: ${port.id}`);
    }
    sources.set(port.source, port.package);
  }
  return metadata;
}

export function pathInRepository(root: string, path: string) {
  return Effect.gen(function* () {
    const base = resolve(root);
    const target = resolve(base, path);
    const rel = relative(base, target);
    if (isAbsolute(path) || !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      return yield* Effect.fail(
        new DevCliError({ message: `Expected a repository-relative path: ${path}` })
      );
    }
    let current = base;
    for (const component of rel.split(sep)) {
      current = join(current, component);
      const info = yield* inspectOptional(current);
      if (info?.isSymbolicLink()) {
        return yield* Effect.fail(
          new DevCliError({ message: `Release paths cannot be symlinks: ${path}` })
        );
      }
    }
    return target;
  });
}

export function loadMetadata(root = repositoryRoot()) {
  return Effect.gen(function* () {
    const source = yield* readText(yield* pathInRepository(root, METADATA_FILE));
    return yield* checked(() => parseMetadata(source));
  });
}
