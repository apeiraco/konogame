import { open, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { Cause, Effect } from "effect";
import { createTestDirectory } from "../../../../../tests/support/temp.ts";
import { provideTestCli, testCliContext } from "../../__tests__/support/context.ts";
import { Cancelled, CliError } from "../../context.ts";
import { type CliCommand, CliCommandName } from "../../parser/index.ts";
import { executeGame } from "../command.ts";

type DiscoverCommand = Extract<CliCommand, { kind: typeof CliCommandName.gameDiscover }>;
type ImportCommand = Extract<CliCommand, { kind: typeof CliCommandName.gameImport }>;

const workspaceId = "019a0000-0000-7000-8000-000000000001";
const hostId = "019a0000-0000-7000-8000-000000000002";
const operationId = "019a0000-0000-7000-8000-000000000003";
const candidateId = "019a0000-0000-7000-8000-000000000004";

function discoverCommand(overrides: Partial<DiscoverCommand> = {}): DiscoverCommand {
  return {
    kind: CliCommandName.gameDiscover,
    json: true,
    interactive: false,
    nonInteractive: false,
    root: "workspace-root",
    hostId,
    sourceId: "local",
    scope: [],
    exclude: [],
    ...overrides
  } as DiscoverCommand;
}

function importCommand(overrides: Partial<ImportCommand> = {}): ImportCommand {
  return {
    kind: CliCommandName.gameImport,
    json: true,
    interactive: false,
    nonInteractive: false,
    root: "workspace-root",
    previewFile: "preview.json",
    candidate: [],
    yes: false,
    ...overrides
  } as ImportCommand;
}

function syntheticPreview(root: string) {
  return {
    schemaVersion: "game-discovery-preview.3",
    operationId,
    createdAt: "2026-01-01T00:00:00Z",
    root,
    workspaceId,
    revision: "rev-1",
    hostId,
    sourceId: "local",
    sourceKind: "standalone",
    scope: { paths: [root], maxDepth: 2, exclude: [] },
    discoveryAdapterId: "filesystem.game-discovery",
    configurationAdapterId: "workspace-toml.configuration",
    adapterResolutionPlan: {
      declarationProtocolVersion: "0.2.0",
      resolvedAdapters: [
        {
          feature: "game.discover",
          port: "game.discovery",
          operation: "discover",
          adapterId: "filesystem.game-discovery",
          owner: { kind: "extension", id: "konogame.filesystem" },
          declarationProtocolRange: ">=0.2.0 <0.3.0",
          portVersion: "0.3.0",
          portVersionRange: ">=0.3.0 <0.4.0",
          capabilities: ["discovery.source.standalone"]
        }
      ],
      unavailable: []
    },
    candidates: [
      {
        candidateId,
        observationKey: "standalone:cand-1",
        title: "Sample Field",
        location: {
          type: "filesystem.directory",
          schemaVersion: "1.0.0",
          data: { path: root }
        },
        externalRefs: [],
        evidence: [
          {
            kind: "executable",
            path: "game.exe",
            fingerprint: "sha256:00"
          }
        ],
        provenance: {
          adapterId: "filesystem.game-discovery",
          port: "game.discovery",
          hostId,
          sourceId: "local"
        },
        disposition: "new-game",
        locationValidation: { status: "valid" }
      }
    ],
    diagnostics: [],
    digest: "a".repeat(64)
  };
}

it.effect("game discover requires scope and forwards resolved paths to GAME_ADMISSION", () =>
  Effect.gen(function* () {
    const io = testCliContext();
    const missingScope = yield* Effect.exit(
      provideTestCli(executeGame(discoverCommand()), io.context, {})
    );
    expect(missingScope._tag).toBe("Failure");
    if (missingScope._tag === "Failure") {
      expect((Cause.squash(missingScope.cause) as Error).message).toContain(
        "Missing required argument: scope"
      );
    }

    let captured: unknown;
    yield* provideTestCli(
      executeGame(discoverCommand({ scope: ["scan-target"], exclude: ["cache"] })),
      io.context,
      {
        admission: {
          preview: (input: unknown) =>
            Effect.sync(() => {
              captured = input;
              return { status: "ok" };
            })
        }
      }
    );
    expect(captured).toEqual({
      root: resolve("workspace-root"),
      hostId,
      sourceId: "local",
      scope: {
        paths: [resolve("scan-target")],
        maxDepth: undefined,
        exclude: ["cache"]
      }
    });
  })
);

it.effect(
  "game import requires --yes and --candidate in non-interactive mode, cancels cleanly on declined confirmation, and rejects oversized preview files",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "unit", "cli", "game-command")
      );
      yield* Effect.gen(function* () {
        const previewPath = join(directory, "preview.json");
        yield* Effect.promise(() =>
          writeFile(previewPath, JSON.stringify(syntheticPreview(directory)))
        );

        const nonInteractiveNoYes = yield* Effect.exit(
          provideTestCli(
            executeGame(
              importCommand({
                root: directory,
                previewFile: previewPath,
                candidate: [candidateId],
                yes: false
              })
            ),
            testCliContext().context,
            {}
          )
        );
        expect(nonInteractiveNoYes._tag).toBe("Failure");
        if (nonInteractiveNoYes._tag === "Failure") {
          expect((Cause.squash(nonInteractiveNoYes.cause) as Error).message).toContain("--yes");
        }

        const nonInteractiveNoCandidate = yield* Effect.exit(
          provideTestCli(
            executeGame(
              importCommand({
                root: directory,
                previewFile: previewPath,
                candidate: [],
                yes: true
              })
            ),
            testCliContext().context,
            {}
          )
        );
        expect(nonInteractiveNoCandidate._tag).toBe("Failure");
        if (nonInteractiveNoCandidate._tag === "Failure") {
          expect((Cause.squash(nonInteractiveNoCandidate.cause) as Error).message).toContain(
            "--candidate"
          );
        }

        let imports = 0;
        let selects = 0;
        const interactiveIo = testCliContext({
          interactive: true,
          select: () =>
            Effect.sync(() => {
              selects++;
              return selects === 1 ? candidateId : "";
            }),
          confirm: () => Effect.succeed(false)
        });
        const cancelled = yield* Effect.exit(
          provideTestCli(
            executeGame(
              importCommand({
                interactive: true,
                root: directory,
                previewFile: previewPath,
                candidate: [],
                yes: false
              })
            ),
            interactiveIo.context,
            {
              admission: {
                import: () =>
                  Effect.sync(() => {
                    imports++;
                    return { status: "imported" };
                  })
              }
            }
          )
        );
        expect(cancelled._tag).toBe("Failure");
        if (cancelled._tag === "Failure") {
          expect(Cause.squash(cancelled.cause)).toBeInstanceOf(Cancelled);
        }
        expect(imports).toBe(0);
        expect(interactiveIo.stderr.join("")).toContain("candidates: 1");

        const oversizedPath = join(directory, "oversized.json");
        const handle = yield* Effect.promise(() => open(oversizedPath, "w"));
        yield* Effect.promise(() => handle.truncate(8 * 1024 * 1024 + 1));
        yield* Effect.promise(() => handle.close());
        const oversized = yield* Effect.exit(
          provideTestCli(
            executeGame(
              importCommand({
                root: directory,
                previewFile: oversizedPath,
                candidate: [candidateId],
                yes: true
              })
            ),
            testCliContext().context,
            {}
          )
        );
        expect(oversized._tag).toBe("Failure");
        if (oversized._tag === "Failure") {
          expect(Cause.squash(oversized.cause)).toBeInstanceOf(CliError);
          expect((Cause.squash(oversized.cause) as Error).message).toContain("8 MiB");
        }
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(Effect.orDie)
        )
      );
    })
);
