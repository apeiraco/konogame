import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import { WORKSPACE_SCHEMA } from "@konogame/workspace";
import { Cause, Effect } from "effect";
import { createTestDirectory } from "../../../../../../tests/support/temp.ts";
import { provideTestCli, testCliContext } from "../../../__tests__/support/context.ts";
import { Cancelled, CliError } from "../../../context.ts";
import { type CliCommand, CliCommandName } from "../../../parser/index.ts";
import { executeHost } from "../../host/command.ts";
import { executeImport } from "../../import/command.ts";
import { executeInit } from "../../init/command.ts";
import { executeEdit } from "../command.ts";

type EditPreviewCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceEditPreview }>;
type EditApplyCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceEditApply }>;
type EditRecoverCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceEditRecover }>;

const operationId = "019a0000-0000-7000-8000-000000000099";

function previewCommand(overrides: Partial<EditPreviewCommand> = {}): EditPreviewCommand {
  return {
    kind: CliCommandName.workspaceEditPreview,
    json: true,
    interactive: false,
    nonInteractive: false,
    root: "synthetic-root",
    unsetEdition: false,
    rootSet: [],
    rootRemove: [],
    sourceSet: [],
    sourceRemove: [],
    preferredAdapter: [],
    clearPreferredAdapter: [],
    ...overrides
  } as EditPreviewCommand;
}

function snapshot() {
  const workspaceId = "019a0000-0000-7000-8000-000000000010";
  const gameId = "019a0000-0000-7000-8000-000000000011";
  const hostId = "019a0000-0000-7000-8000-000000000012";
  const installationId = "019a0000-0000-7000-8000-000000000013";
  return {
    root: resolve("synthetic-root"),
    revision: "rev-1",
    workspace: {
      kind: "workspace" as const,
      schemaVersion: WORKSPACE_SCHEMA,
      id: workspaceId,
      name: "Synthetic Workspace",
      defaults: {},
      history: { mode: "disabled" as const }
    },
    games: [
      {
        kind: "game" as const,
        schemaVersion: WORKSPACE_SCHEMA,
        id: gameId,
        uniformName: "Synthetic Game",
        title: "Synthetic Game",
        edition: "Original Cut",
        externalIds: {},
        settings: {}
      }
    ],
    hosts: [
      {
        kind: "host" as const,
        schemaVersion: WORKSPACE_SCHEMA,
        id: hostId,
        uniformName: "workstation",
        label: "Workstation",
        platform: "windows" as const,
        roots: { games: "C:\\Games" },
        defaults: {},
        gameOverrides: {},
        sources: [{ id: "local", kind: "standalone", status: "configured" as const }]
      }
    ],
    installations: [
      {
        kind: "installation" as const,
        schemaVersion: WORKSPACE_SCHEMA,
        id: installationId,
        uniformName: "Synthetic Installation",
        gameId,
        hostId,
        sourceId: "local",
        status: "present" as const,
        location: {
          type: "filesystem.directory",
          schemaVersion: "1.0.0",
          data: { path: "C:\\Games\\Synthetic" }
        },
        launch: {},
        settings: {}
      }
    ]
  };
}

it.effect(
  "edit preview converts metadata, roots, sources, and settings flags and rejects conflicting flag combinations",
  () =>
    Effect.gen(function* () {
      const snap = snapshot();
      const changes: unknown[] = [];
      const workspace = {
        read: () => Effect.succeed({ snapshot: snap }),
        preview: (input: { change: unknown }) =>
          Effect.sync(() => {
            changes.push(input.change);
            return { status: "preview" };
          })
      };

      yield* provideTestCli(
        executeEdit(previewCommand({ recordId: snap.games[0]!.id, title: "Renamed Game" })),
        testCliContext().context,
        { workspace }
      );
      expect(changes.at(-1)).toEqual({
        kind: "metadata.replace",
        target: { kind: "game", recordId: snap.games[0]!.id },
        metadata: { title: "Renamed Game", edition: "Original Cut" }
      });

      yield* provideTestCli(
        executeEdit(
          previewCommand({
            recordId: snap.games[0]!.id,
            title: "Renamed Game",
            unsetEdition: true
          })
        ),
        testCliContext().context,
        { workspace }
      );
      expect(changes.at(-1)).toEqual({
        kind: "metadata.replace",
        target: { kind: "game", recordId: snap.games[0]!.id },
        metadata: { title: "Renamed Game" }
      });

      yield* provideTestCli(
        executeEdit(
          previewCommand({
            hostId: snap.hosts[0]!.id,
            rootSet: ["steam=D:\\Steam"],
            rootRemove: ["games"]
          })
        ),
        testCliContext().context,
        { workspace }
      );
      expect(changes.at(-1)).toEqual({
        kind: "host.roots.replace",
        hostId: snap.hosts[0]!.id,
        roots: { steam: "D:\\Steam" }
      });

      yield* provideTestCli(
        executeEdit(
          previewCommand({
            hostId: snap.hosts[0]!.id,
            sourceSet: ["local:standalone:planned", "steam:steam:configured"]
          })
        ),
        testCliContext().context,
        { workspace }
      );
      expect(changes.at(-1)).toEqual({
        kind: "host.sources.replace",
        hostId: snap.hosts[0]!.id,
        sources: [
          { id: "local", kind: "standalone", status: "planned" },
          { id: "steam", kind: "steam", status: "configured" }
        ]
      });

      yield* provideTestCli(
        executeEdit(
          previewCommand({
            hostId: snap.hosts[0]!.id,
            kindName: "host-game",
            gameId: snap.games[0]!.id,
            argumentsJson: '["--safe"]',
            clearPreferredAdapter: ["save.store"]
          })
        ),
        testCliContext().context,
        { workspace }
      );
      expect(changes.at(-1)).toEqual({
        kind: "settings.replace",
        target: {
          kind: "host-game",
          recordId: snap.hosts[0]!.id,
          gameId: snap.games[0]!.id
        },
        settings: {
          arguments: ["--safe"],
          clear: { preferredAdapters: ["save.store"] }
        }
      });

      for (const bad of [
        previewCommand({ hostId: snap.hosts[0]!.id, recordId: snap.games[0]!.id, label: "X" }),
        previewCommand({
          hostId: snap.hosts[0]!.id,
          rootSet: ["games=/a"],
          rootRemove: ["games"]
        }),
        previewCommand({
          recordId: snap.games[0]!.id,
          edition: "Cut",
          unsetEdition: true
        }),
        previewCommand({
          recordId: snap.games[0]!.id,
          settingsJson: "{}",
          argumentsJson: "[]"
        }),
        previewCommand({
          recordId: snap.games[0]!.id,
          title: "Both",
          settingsJson: "{}"
        })
      ]) {
        const exit = yield* Effect.exit(
          provideTestCli(executeEdit(bad), testCliContext().context, { workspace })
        );
        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          expect(Cause.squash(exit.cause)).toBeInstanceOf(CliError);
        }
      }
    })
);

it.effect(
  "write and recovery CLI commands require --yes in non-interactive mode and cancel cleanly without writing when declined",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "unit", "cli", "edit-command")
      );
      yield* Effect.gen(function* () {
        const snap = snapshot();
        const previewPath = join(directory, "edit-preview.json");
        const validPreview = {
          schemaVersion: "workspace-edit-preview.1",
          operationId,
          root: resolve(directory),
          workspaceId: snap.workspace.id,
          expectedRevision: snap.revision,
          configurationAdapterId: "fixture.configuration",
          change: {
            kind: "metadata.replace",
            target: { kind: "workspace", recordId: snap.workspace.id },
            metadata: { name: "Updated" }
          },
          differences: [
            {
              field: "name",
              before: snap.workspace.name,
              after: "Updated"
            }
          ],
          readAdapterResolutionPlan: {
            declarationProtocolVersion: "0.2.0",
            resolvedAdapters: [
              {
                feature: "workspace.configuration.read",
                port: "workspace.configuration",
                operation: "read",
                adapterId: "fixture.configuration",
                owner: { kind: "extension", id: "fixture.workspace" },
                declarationProtocolRange: ">=0.2.0 <0.3.0",
                portVersion: "0.2.0",
                portVersionRange: ">=0.2.0 <0.3.0",
                capabilities: ["configuration.read", "configuration.edit"]
              }
            ],
            unavailable: []
          },
          applyAdapterResolutionPlan: {
            declarationProtocolVersion: "0.2.0",
            resolvedAdapters: [
              {
                feature: "workspace.configuration.edit",
                port: "workspace.configuration",
                operation: "edit",
                adapterId: "fixture.configuration",
                owner: { kind: "extension", id: "fixture.workspace" },
                declarationProtocolRange: ">=0.2.0 <0.3.0",
                portVersion: "0.2.0",
                portVersionRange: ">=0.2.0 <0.3.0",
                capabilities: ["configuration.read", "configuration.edit"]
              }
            ],
            unavailable: []
          },
          digest: "b".repeat(64)
        };
        yield* Effect.promise(() => writeFile(previewPath, JSON.stringify(validPreview)));

        let writes = 0;
        const workspace = {
          preview: () => Effect.succeed(validPreview),
          apply: () =>
            Effect.sync(() => {
              writes++;
              return { status: "edited" };
            }),
          recoverEdit: () =>
            Effect.sync(() => {
              writes++;
              return { status: "edited" };
            }),
          initialize: () =>
            Effect.sync(() => {
              writes++;
              return { status: "initialized" };
            }),
          recoverInitialize: () =>
            Effect.sync(() => {
              writes++;
              return { status: "initialized" };
            }),
          recoverWorkspaceImport: () =>
            Effect.sync(() => {
              writes++;
              return { status: "imported" };
            })
        };
        const ids = { uuidV7: () => Effect.succeed(operationId) };

        const commands = [
          executeEdit({
            kind: CliCommandName.workspaceEditApply,
            json: true,
            interactive: false,
            nonInteractive: false,
            root: directory,
            previewFile: previewPath,
            yes: false
          } as unknown as EditApplyCommand),
          executeEdit({
            kind: CliCommandName.workspaceEditRecover,
            json: true,
            interactive: false,
            nonInteractive: false,
            root: directory,
            operationId,
            yes: false
          } as unknown as EditRecoverCommand),
          executeInit({
            kind: CliCommandName.workspaceInit,
            json: true,
            interactive: false,
            nonInteractive: false,
            root: directory,
            name: "Desk",
            hostName: "workstation",
            platform: "windows",
            yes: false
          } as unknown as Extract<CliCommand, { kind: typeof CliCommandName.workspaceInit }>),
          executeInit({
            kind: CliCommandName.workspaceRecoverInitialize,
            json: true,
            interactive: false,
            nonInteractive: false,
            root: directory,
            operationId,
            yes: false
          } as unknown as Extract<
            CliCommand,
            { kind: typeof CliCommandName.workspaceRecoverInitialize }
          >),
          executeHost({
            kind: CliCommandName.workspaceHostAdd,
            json: true,
            interactive: false,
            nonInteractive: false,
            root: directory,
            uniformName: "laptop",
            platform: "linux",
            apply: true,
            yes: false
          } as unknown as Extract<CliCommand, { kind: typeof CliCommandName.workspaceHostAdd }>),
          executeImport({
            kind: CliCommandName.workspaceRecoverImport,
            json: true,
            interactive: false,
            nonInteractive: false,
            root: directory,
            operationId,
            yes: false
          } as unknown as Extract<
            CliCommand,
            { kind: typeof CliCommandName.workspaceRecoverImport }
          >)
        ];

        for (const cmd of commands) {
          const nonInteractiveExit = yield* Effect.exit(
            provideTestCli(cmd, testCliContext().context, { workspace, ids })
          );
          expect(nonInteractiveExit._tag).toBe("Failure");
          if (nonInteractiveExit._tag === "Failure") {
            expect(Cause.squash(nonInteractiveExit.cause)).toBeInstanceOf(CliError);
            expect((Cause.squash(nonInteractiveExit.cause) as Error).message).toContain("--yes");
          }

          const declinedExit = yield* Effect.exit(
            provideTestCli(
              cmd,
              testCliContext({ interactive: true, confirm: () => Effect.succeed(false) }).context,
              { workspace, ids }
            )
          );
          expect(declinedExit._tag).toBe("Failure");
          if (declinedExit._tag === "Failure") {
            expect(Cause.squash(declinedExit.cause)).toBeInstanceOf(Cancelled);
          }
        }
        expect(writes).toBe(0);
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => rm(directory, { recursive: true, force: true })).pipe(Effect.orDie)
        )
      );
    })
);
