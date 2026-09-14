import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { startDaemon } from "@konogame/daemon";
import { filesystemSourceKind } from "@konogame/extension-filesystem/manifest";
import { gameDiscoveryPreviewSchema } from "@konogame/game/admission";
import { UuidIdService } from "@konogame/infrastructure";
import { assertSchema } from "@konogame/infrastructure/contracts";
import {
  HistoryMode,
  HostPlatform,
  RecordKind,
  SourceStatus,
  WORKSPACE_SCHEMA
} from "@konogame/workspace/contracts";
import { Effect } from "effect";
import { gameListResponseSchema, gameShowResponseSchema } from "../../src/api/game-schemas.ts";

it.live("HTTP discovery admission populates the library and stores multi-file saves", () =>
  Effect.gen(function* () {
    const ids = new UuidIdService();
    const directory = join(resolve("temp/tests/daemon-game-save-http"), yield* ids.uuidV7());
    const root = join(directory, "workspace");
    const gameDirectory = join(directory, "games", "Synthetic Game");
    const saveDirectory = join(directory, "input-save");
    const saveRoot = join(directory, "stored-saves");
    yield* Effect.acquireRelease(
      Effect.promise(() => mkdir(directory, { recursive: true })),
      () => Effect.promise(() => rm(directory, { recursive: true, force: true }))
    );
    yield* Effect.all([
      Effect.promise(() => mkdir(root)),
      Effect.promise(() => mkdir(gameDirectory, { recursive: true })),
      Effect.promise(() => mkdir(join(saveDirectory, "nested"), { recursive: true }))
    ]);
    yield* Effect.all([
      Effect.promise(() => writeFile(join(gameDirectory, "game.dat"), "synthetic-game")),
      Effect.promise(() =>
        writeFile(join(saveDirectory, "slot.bin"), Buffer.alloc(1024 * 1024 + 17, 42))
      ),
      Effect.promise(() => writeFile(join(saveDirectory, "nested", "meta.txt"), "synthetic-save"))
    ]);
    const server = yield* startDaemon({ port: 0, saveRoot });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP listener");
    }
    const base = `http://127.0.0.1:${address.port}`;
    const call = (path: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await fetch(
          `${base}${path}`,
          body === undefined
            ? undefined
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body)
              }
        );
        return { status: response.status, body: (await response.json()) as unknown };
      });
    const workspaceId = yield* ids.uuidV7();
    const hostId = yield* ids.uuidV7();
    const initialized = yield* call("/api/workspace/initialize", {
      root,
      operationId: yield* ids.uuidV7(),
      confirmed: true,
      workspace: {
        schemaVersion: WORKSPACE_SCHEMA,
        kind: RecordKind.Workspace,
        id: workspaceId,
        name: "Synthetic library",
        defaults: {},
        history: { mode: HistoryMode.Disabled }
      },
      host: {
        schemaVersion: WORKSPACE_SCHEMA,
        kind: RecordKind.Host,
        id: hostId,
        uniformName: "synthetic-host",
        label: "Synthetic Host",
        platform:
          process.platform === "win32"
            ? HostPlatform.Windows
            : process.platform === "darwin"
              ? HostPlatform.MacOS
              : HostPlatform.Linux,
        roots: {},
        defaults: {},
        gameOverrides: {},
        sources: [{ id: "loose", kind: filesystemSourceKind, status: SourceStatus.Configured }]
      }
    });
    expect(initialized.status, JSON.stringify(initialized.body)).toBe(200);
    expect(initialized.body).toMatchObject({ status: "initialized", workspaceId, hostId });

    const observed = yield* call("/api/game-discovery-previews", {
      root,
      hostId,
      sourceId: "loose",
      scope: { paths: [gameDirectory], maxDepth: 0, exclude: [] }
    });
    expect(observed.status, JSON.stringify(observed.body)).toBe(200);
    const preview = assertSchema(
      "test.discovery-preview",
      gameDiscoveryPreviewSchema,
      observed.body
    );
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]?.title).toBe("Synthetic Game");
    const admission = {
      root,
      preview,
      selectedCandidateIds: preview.candidates.map((candidate) => candidate.candidateId),
      confirmed: true
    };
    expect((yield* call("/api/game-admissions", { ...admission, confirmed: false })).status).toBe(
      400
    );
    const altered = yield* call("/api/game-admissions", {
      ...admission,
      preview: { ...preview, revision: "tampered" }
    });
    expect(altered.status, JSON.stringify(altered.body)).toBe(409);
    const admitted = yield* call("/api/game-admissions", admission);
    expect(admitted.status, JSON.stringify(admitted.body)).toBe(200);
    expect(admitted.body).toMatchObject({ status: "imported" });
    const query = new URLSearchParams({ root });
    const listed = yield* call(`/api/games?${query}`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const library = assertSchema("test.game-list", gameListResponseSchema, listed.body);
    expect(library.games).toHaveLength(1);
    const game = library.games[0]!;
    const shown = yield* call(`/api/games/${game.id}?${query}`);
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    const detail = assertSchema("test.game-show", gameShowResponseSchema, shown.body);
    expect(detail.game).toMatchObject({
      id: game.id,
      title: "Synthetic Game",
      installations: [{ hostId, sourceId: "loose" }]
    });
    expect((yield* call("/api/game-admissions", admission)).status).toBe(409);

    const stored = yield* call("/api/saves", { directory: saveDirectory });
    expect(stored.status, JSON.stringify(stored.body)).toBe(200);
    const reference = stored.body as { id: string; mediaType: string };
    expect(reference.mediaType).toBe("application/vnd.konogame.save-directory");
    const storedDirectory = join(saveRoot, reference.id, "files");
    const [slot, metadata] = yield* Effect.all([
      Effect.promise(() => readFile(join(storedDirectory, "slot.bin"))),
      Effect.promise(() => readFile(join(storedDirectory, "nested", "meta.txt"), "utf8"))
    ]);
    expect(slot.byteLength).toBe(1024 * 1024 + 17);
    expect(slot.every((byte) => byte === 42)).toBe(true);
    expect(metadata).toBe("synthetic-save");
  })
);
