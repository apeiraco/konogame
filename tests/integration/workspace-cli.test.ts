import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { filesystemExtensionSource } from "@konogame/extension-filesystem/providers";
import { steamExtensionSource } from "@konogame/extension-steam/providers";
import { GAME_ADMISSION } from "@konogame/game/admission";
import { ID_SERVICE } from "@konogame/infrastructure";
import { WORKSPACE_SCHEMA } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Context, Effect, Layer } from "effect";
import { directoryContents } from "../support/discovery.ts";
import { createTestDirectory } from "../support/temp.ts";
import { composeInfrastructure } from "../support/use-cases.ts";

const platform =
  process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux";

it.effect(
  "workspace and game modules initialize a directory, maintain Hosts/sources, admit Steam and standalone games, and explain seven-layer settings",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "integration", "workspace-journey", "root")
      );
      yield* Effect.gen(function* () {
        const workspace = join(root, "workspace");
        yield* Effect.promise(() => mkdir(workspace));
        const services = yield* Layer.build(
          composeInfrastructure({
            discoverySources: [
              filesystemExtensionSource({ saveRoot: join(root, "saves") }),
              steamExtensionSource()
            ]
          })
        );
        const management = Context.get(services, WORKSPACE_MANAGEMENT);
        const admission = Context.get(services, GAME_ADMISSION);
        const ids = Context.get(services, ID_SERVICE);

        const workspaceId = yield* ids.uuidV7();
        const hostId = yield* ids.uuidV7();
        const initialized = yield* management.initialize({
          root: workspace,
          operationId: yield* ids.uuidV7(),
          workspace: {
            kind: "workspace",
            schemaVersion: WORKSPACE_SCHEMA,
            id: workspaceId,
            name: "Synthetic library",
            defaults: {},
            history: { mode: "disabled" }
          },
          host: {
            kind: "host",
            schemaVersion: WORKSPACE_SCHEMA,
            id: hostId,
            uniformName: "Primary",
            label: "Primary",
            platform,
            roots: {},
            defaults: {},
            gameOverrides: {},
            sources: []
          }
        });
        expect(initialized.status).toBe("initialized");
        expect((yield* management.inspectWorkspace(workspace)).history.status).toBe("disabled");

        const edit = (change: Parameters<typeof management.preview>[0]["change"]) =>
          Effect.gen(function* () {
            const before = yield* Effect.promise(() => directoryContents(workspace));
            const preview = yield* management.preview({ root: workspace, change });
            expect(yield* Effect.promise(() => directoryContents(workspace))).toEqual(before);
            const result = yield* management.apply({ root: workspace, preview });
            expect(["edited", "unchanged"]).toContain(result.status);
            return preview;
          });

        yield* edit({
          kind: "host.create",
          host: {
            kind: "host",
            schemaVersion: WORKSPACE_SCHEMA,
            id: yield* ids.uuidV7(),
            uniformName: "Other",
            label: "Other",
            platform,
            roots: {},
            defaults: {},
            gameOverrides: {},
            sources: []
          }
        });
        yield* edit({
          kind: "host.sources.replace",
          hostId,
          sources: [
            { id: "steam", kind: "steam", status: "configured" },
            { id: "standalone", kind: "standalone", status: "configured" }
          ]
        });

        const library = join(root, "steam");
        const standalone = join(root, "standalone");
        yield* Effect.promise(() =>
          mkdir(join(library, "steamapps", "common", "SyntheticSteam"), { recursive: true })
        );
        yield* Effect.promise(() =>
          mkdir(join(standalone, "Synthetic Loose Game"), { recursive: true })
        );
        const manifest = join(library, "steamapps", "appmanifest_730002.acf");
        yield* Effect.promise(() =>
          writeFile(
            manifest,
            '"AppState" { "appid" "730002" "name" "Synthetic Steam" "installdir" "SyntheticSteam" "StateFlags" "4" }'
          )
        );
        yield* Effect.promise(() =>
          writeFile(join(standalone, "Synthetic Loose Game", "game.exe"), "never execute")
        );

        yield* edit({
          kind: "host.roots.replace",
          hostId,
          roots: { steam: library, standalone }
        });

        for (const [sourceId, scopePath, preferredAdapterId] of [
          ["steam", library, "steam.game-discovery"],
          ["standalone", standalone, "filesystem.game-discovery"]
        ] as const) {
          const preview = yield* admission.preview({
            root: workspace,
            hostId,
            sourceId,
            scope: { paths: [scopePath], maxDepth: 2, exclude: [] },
            preferredAdapterId
          });
          expect(preview.candidates).toHaveLength(1);
          const imported = yield* admission.import({
            root: workspace,
            preview,
            selectedCandidateIds: [preview.candidates[0]!.candidateId]
          });
          expect(imported.status).toBe("imported");
        }

        const listed = yield* management.listGames(workspace);
        expect(listed.games).toHaveLength(2);
        expect(new Set(listed.games.map((game) => game.installations[0]?.source?.kind))).toEqual(
          new Set(["steam", "standalone"])
        );

        const gameId = listed.games[0]!.id;
        const installationId = listed.games[0]!.installations[0]!.id;
        expect((yield* management.showGame(workspace, gameId)).game.installations).toHaveLength(1);

        yield* edit({
          kind: "metadata.replace",
          target: { kind: "game", recordId: gameId },
          metadata: { title: "Renamed display title", edition: "Deluxe" }
        });
        expect((yield* management.showGame(workspace, gameId)).game.edition).toBe("Deluxe");

        yield* edit({
          kind: "settings.replace",
          target: { kind: "workspace", recordId: workspaceId },
          settings: { arguments: ["workspace"] }
        });
        yield* edit({
          kind: "settings.replace",
          target: { kind: "game", recordId: gameId },
          settings: { arguments: ["game"] }
        });
        yield* edit({
          kind: "settings.replace",
          target: { kind: "host", recordId: hostId },
          settings: { arguments: ["host"] }
        });
        yield* edit({
          kind: "settings.replace",
          target: { kind: "host-game", recordId: hostId, gameId },
          settings: { arguments: ["host-game"] }
        });
        yield* edit({
          kind: "settings.replace",
          target: { kind: "installation", recordId: installationId },
          settings: {
            arguments: [],
            clear: { preferredAdapters: ["save.store"] }
          }
        });

        const explained = yield* management.explainSettings(
          workspace,
          {
            gameId,
            hostId,
            installationId,
            overrides: { arguments: ["invocation"] }
          },
          ["save.store", "unknown.feature"]
        );
        expect(explained.layers).toHaveLength(7);
        expect(explained.effective.origins.arguments).toBe("invocation");
        expect(explained.effective.origins["preferredAdapters.save.store"]).toBe("installation");
        expect(explained.effective.values.preferredAdapters?.["save.store"]).toBeNull();
        expect(explained.features[1]).toMatchObject({
          reason: expect.stringContaining("Unknown feature")
        });

        const noop = yield* edit({
          kind: "metadata.replace",
          target: { kind: "game", recordId: gameId },
          metadata: { title: "Renamed display title", edition: "Deluxe" }
        });
        expect(noop.differences).toEqual([]);
        expect(yield* Effect.promise(() => readFile(manifest, "utf8"))).toContain(
          '"appid" "730002"'
        );
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => rm(root, { recursive: true, force: true })).pipe(Effect.orDie)
        )
      );
    })
);
