import { createReadStream } from "node:fs";
import { lstat, mkdir, open, opendir, readFile, rename, rm, stat } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import {
  type Artifact,
  ArtifactError,
  type ArtifactFile,
  type ArtifactReference
} from "@konogame/contracts";
import { type IdService } from "@konogame/infrastructure";
import { SaveError, type SaveStorePort } from "@konogame/save";
import { type } from "arktype";
import { Effect, Exit, Stream } from "effect";
import { publishArtifact } from "./publication.ts";

interface StoredManifest {
  mediaType: string;
  metadata?: Record<string, string>;
  files: { path: string; size: number }[];
}
const failure = (operation: string, cause: unknown) =>
  new SaveError({
    operation,
    cause,
    message: cause instanceof Error ? cause.message : String(cause)
  });
const artifactFailure = (operation: string, cause: unknown) =>
  new ArtifactError({
    operation,
    cause,
    message: cause instanceof Error ? cause.message : String(cause)
  });
const io = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: (cause) => failure(operation, cause) });

function safeRelativePath(value: string): string {
  if (
    !value ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    posix.normalize(value) !== value ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(`Unsafe artifact path: ${value}`);
  return value;
}
const artifactIdSchema = type.string.matching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
);
const artifactManifestSchema = type({
  "+": "reject",
  mediaType: type.string.atLeastLength(1),
  "metadata?": type({ "+": "reject", "[string]": type.string }),
  files: type({
    "+": "reject",
    path: type.string,
    size: type("number.integer >= 0").narrow(
      (value, ctx) => Number.isSafeInteger(value) || ctx.mustBe("a safe file size")
    )
  }).array()
});

function fileBytes(path: string): Stream.Stream<Uint8Array, ArtifactError> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const input = yield* Effect.acquireRelease(
        Effect.sync(() => createReadStream(path)),
        (stream) =>
          Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                if (stream.closed) {
                  resolve();
                  return;
                }
                const ignoreError = () => {};
                stream.once("close", () => {
                  stream.off("error", ignoreError);
                  resolve();
                });
                stream.on("error", ignoreError);
                if (!stream.destroyed) stream.destroy();
              })
          )
      );
      return Stream.fromAsyncIterable(input.iterator({ destroyOnReturn: false }), (cause) =>
        artifactFailure("read-file", cause)
      );
    })
  );
}

export class FilesystemSaveStore implements SaveStorePort {
  constructor(
    private readonly root: string,
    private readonly ids: IdService
  ) {}

  put(artifact: Artifact): Effect.Effect<ArtifactReference, SaveError> {
    const self = this;
    return Effect.gen(function* () {
      const id = yield* self.ids.uuidV7();
      const directory = join(self.root, id);
      const pending = join(self.root, `.pending-${id}`);
      const manifest: StoredManifest = {
        mediaType: artifact.mediaType,
        metadata: artifact.metadata ? { ...artifact.metadata } : undefined,
        files: []
      };
      const seen = new Set<string>();
      yield* io("create-store-root", () => mkdir(self.root, { recursive: true }));
      return yield* Effect.acquireUseRelease(
        io("create-staging", () => mkdir(pending)),
        () =>
          Effect.gen(function* () {
            yield* Stream.runForEach(artifact.files, (file) =>
              Effect.gen(function* () {
                const path = yield* Effect.try({
                  try: () => safeRelativePath(file.path),
                  catch: (cause) => failure("validate-file", cause)
                });
                if (seen.has(path))
                  return yield* Effect.fail(
                    failure("validate-file", `Duplicate artifact path: ${path}`)
                  );
                seen.add(path);
                const destination = join(pending, "files", ...path.split("/"));
                // Native mkdir must settle before cancellation can remove staging.
                yield* io("create-file-parents", () =>
                  mkdir(resolve(destination, ".."), { recursive: true })
                ).pipe(Effect.uninterruptible);
                yield* Effect.acquireUseRelease(
                  io("open-output", () => open(destination, "wx")),
                  (handle) =>
                    Stream.runForEach(file.open(), (chunk) =>
                      Effect.gen(function* () {
                        let offset = 0;
                        while (offset < chunk.byteLength) {
                          const result = yield* io("write-output", () =>
                            handle.write(chunk, offset, chunk.byteLength - offset)
                          );
                          if (!result.bytesWritten)
                            return yield* Effect.fail(
                              failure("write-output", "Writing artifact made no progress")
                            );
                          offset += result.bytesWritten;
                        }
                      })
                    ),
                  (handle) => io("close-output", () => handle.close())
                );
                manifest.files.push({
                  path,
                  size: (yield* io("inspect-output", () => stat(destination))).size
                });
              })
            );
            // Explicit ownership closes the manifest before publication and prevents replacement.
            yield* Effect.acquireUseRelease(
              io("open-manifest", () => open(join(pending, "manifest.json"), "wx")),
              (handle) =>
                io("write-manifest", (signal) =>
                  handle.writeFile(JSON.stringify(manifest, null, 2), { signal })
                ),
              (handle) => io("close-manifest", () => handle.close())
            );
            yield* publishArtifact(pending, directory, {
              platform: process.platform,
              lstat,
              rename
            });
            return { id, mediaType: artifact.mediaType };
          }),
        (_, exit) =>
          Exit.isFailure(exit)
            ? io("remove-staging", () => rm(pending, { recursive: true, force: true }))
            : Effect.void
      );
    }).pipe(
      Effect.mapError((cause) => (cause instanceof SaveError ? cause : failure("put", cause)))
    );
  }

  open(reference: ArtifactReference): Effect.Effect<Artifact, SaveError> {
    const self = this;
    return Effect.gen(function* () {
      if (artifactIdSchema(reference.id) instanceof type.errors)
        return yield* Effect.fail(failure("open", "Invalid artifact reference"));
      const directory = join(self.root, reference.id);
      const content = yield* io("read-manifest", (signal) =>
        readFile(join(directory, "manifest.json"), {
          encoding: "utf8",
          signal
        })
      );
      const parsed = yield* Effect.try({
        try: () => JSON.parse(content),
        catch: (cause) => failure("parse-manifest", cause)
      });
      const manifest = artifactManifestSchema(parsed);
      if (manifest instanceof type.errors || manifest.mediaType !== reference.mediaType)
        return yield* Effect.fail(failure("open", "Invalid artifact manifest"));
      return {
        mediaType: manifest.mediaType,
        metadata: manifest.metadata,
        files: Stream.fromIterable(manifest.files).pipe(
          Stream.mapEffect((file) =>
            Effect.try({
              try: (): ArtifactFile => {
                const path = safeRelativePath(file.path);
                return {
                  path,
                  size: file.size,
                  open: () => fileBytes(join(directory, "files", ...path.split("/")))
                };
              },
              catch: (cause) => artifactFailure("validate-file", cause)
            })
          )
        )
      };
    });
  }
}

export function artifactFromDirectory(source: string): Effect.Effect<Artifact, ArtifactError> {
  const base = resolve(source);
  const fileIo = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) => artifactFailure(operation, cause)
    });
  function walk(directory: string): Stream.Stream<ArtifactFile, ArtifactError> {
    return Stream.unwrap(
      Effect.gen(function* () {
        const handle = yield* Effect.acquireRelease(
          fileIo("open-directory", () => opendir(directory)),
          (value) => fileIo("close-directory", () => value.close()).pipe(Effect.orDie)
        );
        return Stream.unfold(undefined, () =>
          fileIo("read-directory", () => handle.read()).pipe(
            Effect.map((entry) => (entry ? ([entry, undefined] as const) : undefined))
          )
        ).pipe(
          Stream.flatMap((entry) => {
            const full = join(directory, entry.name);
            if (entry.isDirectory()) return walk(full);
            if (!entry.isFile()) return Stream.empty;
            return Stream.succeed({
              path: relative(base, full).split(sep).join("/"),
              open: () => fileBytes(full)
            });
          })
        );
      })
    );
  }
  return Effect.gen(function* () {
    const sourceStat = yield* fileIo("inspect-source", () => stat(base));
    if (!sourceStat.isDirectory())
      return yield* Effect.fail(
        artifactFailure("open-directory", "Save source must be a directory")
      );
    return {
      mediaType: "application/vnd.konogame.save-directory",
      files: walk(base)
    };
  });
}

