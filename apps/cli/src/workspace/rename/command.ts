import { ID_SERVICE } from "@konogame/infrastructure";
import { RECOVERY_ONLY_REVISION, RenameStatus } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import {
  Cancelled,
  CLI_CONTEXT,
  type CliCommandEffect,
  CliError,
  output,
  required
} from "../../context.ts";
import { type CliCommand, type CliCommandName } from "../../parser/index.ts";

type RenameCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceRename }>;

export function executeRename(command: RenameCommand): CliCommandEffect {
  return Effect.gen(function* () {
    const context = yield* CLI_CONTEXT;
    const root = yield* required(command.root, "root");
    let recordId = command.recordId;
    let uniformName = command.uniformName;
    if (!context.interactive) {
      recordId = yield* required(recordId, "record-id");
      uniformName = yield* required(uniformName, "uniform-name");
    }
    let expectedRevision = command.expectedRevision;
    let inspection:
      | {
          readonly revision: string;
          readonly games: readonly { id: string; uniformName: string }[];
          readonly hosts: readonly { id: string; uniformName: string }[];
          readonly installations: readonly { id: string; uniformName: string }[];
        }
      | undefined;
    if (expectedRevision === undefined || recordId === undefined) {
      yield* Effect.gen(function* () {
        inspection = yield* (yield* WORKSPACE_MANAGEMENT).inspectWorkspace(root, {
          preferredAdapterId: command.adapter
        });
        expectedRevision ??= inspection.revision;
      }).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* context.stderr(
              `Workspace inspection failed; attempting recovery only: ${error instanceof Error ? error.message : String(error)}\n`
            );
            expectedRevision ??= RECOVERY_ONLY_REVISION;
          })
        )
      );
    }
    if (recordId === undefined && context.interactive && inspection) {
      const records = [...inspection.games, ...inspection.hosts, ...inspection.installations];
      if (records.length)
        recordId = yield* context.prompts.select(
          "Record to rename",
          records.map((record) => ({
            value: record.id,
            label: `${record.uniformName} (${record.id})`
          }))
        );
    }
    recordId = yield* required(recordId, "record-id");
    uniformName = yield* required(uniformName, "uniform-name");
    if (
      context.interactive &&
      !(yield* context.prompts.confirm(`Rename ${recordId} to ${uniformName}?`))
    )
      return yield* Effect.fail(new Cancelled("Cancelled"));
    const result = yield* (yield* WORKSPACE_MANAGEMENT).renameWorkspace(
      {
        root,
        recordId,
        uniformName,
        expectedRevision: expectedRevision!,
        operationId: command.operationId ?? (yield* (yield* ID_SERVICE).uuidV7())
      },
      command.adapter
    );
    yield* output(result);
    if (result.status !== RenameStatus.Renamed && result.status !== RenameStatus.Unchanged)
      return yield* Effect.fail(new CliError({ message: `Workspace rename ${result.status}` }));
  });
}
