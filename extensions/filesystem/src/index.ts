import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, opendir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  type AdapterDescriptor,
  type Artifact,
  type ArtifactFile,
  type ArtifactReference,
  type ExtensionDescriptor
} from "@konogame/contracts";
import { type SaveStorePort } from "@konogame/save";
import { v7 as uuidv7 } from "uuid";
import { extensionMetadata } from "./metadata.ts";
import { filesystemWorkspaceConfigurationAdapter } from "./workspace.ts";

export {
  FilesystemWorkspaceConfiguration,
  filesystemWorkspaceConfigurationAdapter,
  parseConfigurationToml
} from "./workspace.ts";

export const filesystemSaveStoreAdapter: AdapterDescriptor = {
  id: "filesystem.save-store",
  extensionId: "konogame.filesystem",
  port: "save.store",
  contractRange: extensionMetadata.contractRange,
  operations: ["put", "open"],
  capabilities: ["artifact.multifile", "artifact.streaming"]
};

export const filesystemExtension: ExtensionDescriptor = {
  ...extensionMetadata,
  adapters: [filesystemSaveStoreAdapter, filesystemWorkspaceConfigurationAdapter]
};

interface StoredManifest {
  mediaType: string;
  metadata?: Record<string, string>;
  files: { path: string; size: number }[];
}

function safeRelativePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    posix.normalize(value) !== value ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe artifact path: ${value}`);
  }
  return value;
}

export class FilesystemSaveStore implements SaveStorePort {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async put(artifact: Artifact): Promise<ArtifactReference> {
    const id = uuidv7();
    const directory = join(this.root, id);
    const pending = join(this.root, `.pending-${id}`);
    const manifest: StoredManifest = {
      mediaType: artifact.mediaType,
      metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
      files: []
    };
    const seen = new Set<string>();
    await mkdir(this.root, { recursive: true });
    await mkdir(pending);
    try {
      for await (const file of artifact.files) {
        const path = safeRelativePath(file.path);
        if (seen.has(path)) throw new Error(`Duplicate artifact path: ${path}`);
        seen.add(path);
        const destination = join(pending, "files", ...path.split("/"));
        await mkdir(resolve(destination, ".."), { recursive: true });
        await pipeline(Readable.from(file.open()), createWriteStream(destination, { flags: "wx" }));
        manifest.files.push({ path, size: (await stat(destination)).size });
      }
      await writeFile(join(pending, "manifest.json"), JSON.stringify(manifest, null, 2));
      await rename(pending, directory);
      return { id, mediaType: artifact.mediaType };
    } catch (error) {
      await rm(pending, { recursive: true, force: true });
      throw error;
    }
  }

  async open(reference: ArtifactReference): Promise<Artifact> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reference.id)
    ) {
      throw new Error("Invalid artifact reference");
    }
    const directory = join(this.root, reference.id);
    const manifest = JSON.parse(
      await readFile(join(directory, "manifest.json"), "utf8")
    ) as StoredManifest;
    if (manifest.mediaType !== reference.mediaType || !Array.isArray(manifest.files))
      throw new Error("Invalid artifact manifest");
    return {
      mediaType: manifest.mediaType,
      metadata: manifest.metadata,
      files: (async function* (): AsyncIterable<ArtifactFile> {
        for (const file of manifest.files) {
          const path = safeRelativePath(file.path);
          yield {
            path,
            size: file.size,
            open: () => createReadStream(join(directory, "files", ...path.split("/")))
          };
        }
      })()
    };
  }
}

export async function artifactFromDirectory(source: string): Promise<Artifact> {
  const base = resolve(source);
  const sourceStat = await stat(base);
  if (!sourceStat.isDirectory()) throw new Error("Save source must be a directory");
  async function* walk(directory: string): AsyncIterable<ArtifactFile> {
    const entries = await opendir(directory);
    for await (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) yield* walk(full);
      else if (entry.isFile()) {
        const path = relative(base, full).split(sep).join("/");
        yield { path, open: () => createReadStream(full) };
      }
    }
  }
  return { mediaType: "application/vnd.konogame.save-directory", files: walk(base) };
}
