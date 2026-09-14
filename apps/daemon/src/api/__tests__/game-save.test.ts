import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { GAME_ADMISSION, GAME_DISCOVERY_PREVIEW_SCHEMA } from "@konogame/game/admission";
import { UuidIdService } from "@konogame/infrastructure";
import { type Artifact } from "@konogame/infrastructure/contracts";
import { SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect, Stream } from "effect";
import { DAEMON_ARTIFACT_INPUT, provideDaemonArtifactInput } from "../../artifact-input.ts";
import { gameRoutes } from "../game.ts";
import { type ApiRequest } from "../route.ts";
import { saveRoutes } from "../save.ts";

const id = (value: number) => `01900000-0000-7000-8000-${String(value).padStart(12, "0")}`;
const root = resolve("temp/tests/synthetic-workspace");
const plan = { declarationProtocolVersion: "0.2.0", resolvedAdapters: [], unavailable: [] };

const routes = [...gameRoutes, ...saveRoutes] as const;
function route<Path extends (typeof routes)[number]["path"]>(
  path: Path
): Extract<(typeof routes)[number], { readonly path: Path }> {
  const selected = routes.find((item) => item.path === path);
  if (!selected) {
    throw new Error(`Unknown test route: ${path}`);
  }
  return selected as Extract<(typeof routes)[number], { readonly path: Path }>;
}
function request(body?: unknown, query = "", params: Record<string, string> = {}): ApiRequest {
  return { body, query: new URLSearchParams(query), params };
}

it.effect("Game library routes validate selection and delegate owner queries", () =>
  Effect.gen(function* () {
    const calls: unknown[] = [];
    const management = {
      listGames: (...args: unknown[]) =>
        Effect.sync(() => {
          calls.push(args);
          return { games: [] };
        }),
      showGame: (...args: unknown[]) =>
        Effect.sync(() => {
          calls.push(args);
          return { game: { id: id(2) } };
        })
    } as unknown as WORKSPACE_MANAGEMENT["Service"];
    const query = new URLSearchParams({
      root,
      hostId: id(1),
      sourceId: "loose",
      preferredAdapterId: "fixture.configuration"
    });
    expect(
      yield* route("/api/games")
        .handler({ ...request(), query })
        .pipe(Effect.provideService(WORKSPACE_MANAGEMENT, management))
    ).toEqual({ games: [] });
    yield* route("/api/games/{gameId}")
      .handler(request(undefined, new URLSearchParams({ root }).toString(), { gameId: id(2) }))
      .pipe(Effect.provideService(WORKSPACE_MANAGEMENT, management));
    expect(calls).toEqual([
      [root, { hostId: id(1), sourceId: "loose", preferredAdapterId: "fixture.configuration" }],
      [root, id(2), undefined]
    ]);
    for (const query of [
      "root=one&root=two",
      new URLSearchParams({ root, surprise: "true" }).toString(),
      new URLSearchParams({ root, hostId: "bad" }).toString()
    ]) {
      const result = yield* Effect.result(
        route("/api/games")
          .handler(request(undefined, query))
          .pipe(Effect.provideService(WORKSPACE_MANAGEMENT, management))
      );
      expect(result._tag).toBe("Failure");
    }
    expect(calls).toHaveLength(2);
  })
);

it.effect(
  "discovery preserves opaque scope and admission requires selected, explicit confirmation",
  () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const admission = {
        preview: (input: unknown) =>
          Effect.sync(() => {
            calls.push(input);
            return { review: true };
          }),
        import: (input: unknown) =>
          Effect.sync(() => {
            calls.push(input);
            return { status: "imported" };
          })
      } as unknown as GAME_ADMISSION["Service"];
      const input = {
        root,
        hostId: id(1),
        sourceId: "custom",
        scope: { segment: "synthetic", options: [true, 3] },
        preferredAdapterId: "fixture.discovery"
      };
      yield* route("/api/game-discovery-previews")
        .handler(request(input))
        .pipe(Effect.provideService(GAME_ADMISSION, admission));
      expect(calls).toEqual([input]);
      const preview = {
        schemaVersion: GAME_DISCOVERY_PREVIEW_SCHEMA,
        operationId: id(3),
        createdAt: "2026-11-03T00:00:00Z",
        root,
        workspaceId: id(4),
        revision: "synthetic-revision",
        hostId: id(1),
        sourceId: "custom",
        sourceKind: "custom",
        scope: input.scope,
        discoveryAdapterId: "fixture.discovery",
        configurationAdapterId: "fixture.configuration",
        candidates: [],
        diagnostics: [],
        adapterResolutionPlan: plan,
        digest: "a".repeat(64)
      };
      const body = { root, preview, selectedCandidateIds: [id(5)], confirmed: true };
      for (const invalid of [
        { ...body, confirmed: false },
        { ...body, confirmed: undefined },
        { ...body, selectedCandidateIds: [] },
        { ...body, selectedCandidateIds: [id(5), id(5)] },
        { ...body, preview: { ...preview, surprise: true } },
        { ...body, preview: { ...preview, digest: "bad" } }
      ]) {
        const result = yield* Effect.result(
          route("/api/game-admissions")
            .handler(request(invalid))
            .pipe(Effect.provideService(GAME_ADMISSION, admission))
        );
        expect(result._tag).toBe("Failure");
      }
      expect(calls).toHaveLength(1);
      yield* route("/api/game-admissions")
        .handler(request(body))
        .pipe(Effect.provideService(GAME_ADMISSION, admission));
      expect(calls[1]).toEqual({ root, preview, selectedCandidateIds: [id(5)] });
    })
);

it.live(
  "Save route delegates a multi-file Artifact whose file bytes are consumed incrementally",
  () =>
    Effect.gen(function* () {
      const directory = join(
        resolve("temp/tests/daemon-save"),
        yield* new UuidIdService().uuidV7()
      );
      yield* Effect.acquireRelease(
        Effect.promise(() => mkdir(join(directory, "nested"), { recursive: true })),
        () => Effect.promise(() => rm(directory, { recursive: true, force: true }))
      );
      const largeSize = 1024 * 1024 + 7;
      yield* Effect.all([
        Effect.promise(() => writeFile(join(directory, "large.bin"), Buffer.alloc(largeSize, 13))),
        Effect.promise(() => writeFile(join(directory, "nested", "small.dat"), "synthetic"))
      ]);
      const files: { path: string; bytes: number; chunks: number; largest: number }[] = [];
      let preference: string | undefined;
      const save = {
        storeSave: (artifact: Artifact, adapter?: string) =>
          Effect.gen(function* () {
            preference = adapter;
            expect(artifact.mediaType).toBe("application/vnd.konogame.save-directory");
            yield* Stream.runForEach(artifact.files, (file) =>
              Effect.gen(function* () {
                const observed = { path: file.path, bytes: 0, chunks: 0, largest: 0 };
                yield* Stream.runForEach(file.open(), (chunk) =>
                  Effect.sync(() => {
                    observed.bytes += chunk.byteLength;
                    observed.chunks++;
                    observed.largest = Math.max(observed.largest, chunk.byteLength);
                  })
                );
                files.push(observed);
              })
            );
            return { id: id(6), mediaType: artifact.mediaType };
          })
      } as unknown as SAVE_STORE_WORKFLOW["Service"];
      const result = yield* route("/api/saves")
        .handler(request({ directory, preferredAdapterId: "fixture.store" }))
        .pipe(
          Effect.provideService(SAVE_STORE_WORKFLOW, save),
          Effect.provide(provideDaemonArtifactInput())
        );
      expect(result).toMatchObject({ id: id(6) });
      expect(preference).toBe("fixture.store");
      expect(files.map((file) => file.path).sort()).toEqual(["large.bin", "nested/small.dat"]);
      expect(files.find((file) => file.path === "large.bin")).toMatchObject({
        bytes: largeSize,
        chunks: expect.any(Number)
      });
      const large = files.find((file) => file.path === "large.bin")!;
      expect(large.chunks).toBeGreaterThan(1);
      expect(large.largest).toBeLessThan(largeSize);
      for (const invalid of [
        { directory: "relative" },
        { directory, bytes: "buffered" },
        { directory: "" }
      ]) {
        expect(
          (yield* Effect.result(
            route("/api/saves")
              .handler(request(invalid))
              .pipe(
                Effect.provideService(SAVE_STORE_WORKFLOW, save),
                Effect.provide(provideDaemonArtifactInput())
              )
          ))._tag
        ).toBe("Failure");
      }
    })
);

it.effect("Save source input is replaceable without accessing the caller directory", () =>
  Effect.gen(function* () {
    const sourceDirectory = resolve("synthetic-unopened-source");
    const artifact: Artifact = { mediaType: "application/x-synthetic", files: Stream.empty };
    const opened: string[] = [];
    const stored: Artifact[] = [];
    const workflow = {
      storeSave: (value: Artifact) =>
        Effect.sync(() => {
          stored.push(value);
          return { id: id(9), mediaType: value.mediaType };
        })
    } as unknown as SAVE_STORE_WORKFLOW["Service"];
    const result = yield* route("/api/saves")
      .handler(request({ directory: sourceDirectory }))
      .pipe(
        Effect.provideService(DAEMON_ARTIFACT_INPUT, {
          fromDirectory: (directory) =>
            Effect.sync(() => {
              opened.push(directory);
              return artifact;
            })
        }),
        Effect.provideService(SAVE_STORE_WORKFLOW, workflow)
      );
    expect(opened).toEqual([sourceDirectory]);
    expect(stored).toEqual([artifact]);
    expect(result).toEqual({ id: id(9), mediaType: artifact.mediaType });
  })
);
