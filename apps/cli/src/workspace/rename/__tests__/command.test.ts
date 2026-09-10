import { expect, it } from "@effect/vitest";
import { RECOVERY_ONLY_REVISION, RenameStatus } from "@konogame/workspace";
import { Cause, Effect } from "effect";
import { provideTestCli, testCliContext } from "../../../__tests__/support/context.ts";
import { Cancelled, CliError } from "../../../context.ts";
import { type CliCommand, CliCommandName } from "../../../parser/index.ts";
import { executeRename } from "../command.ts";

type RenameCommand = Extract<CliCommand, { kind: typeof CliCommandName.workspaceRename }>;

const operationId = "019a0000-0000-7000-8000-000000000001";

function command(overrides: Partial<RenameCommand> = {}): RenameCommand {
  return {
    kind: CliCommandName.workspaceRename,
    json: true,
    interactive: false,
    nonInteractive: false,
    root: "synthetic",
    recordId: "record",
    uniformName: "new-name",
    ...overrides
  } as RenameCommand;
}

function ids() {
  return { uuidV7: () => Effect.succeed(operationId) };
}

function inspected() {
  return { revision: "observed-revision", games: [], hosts: [], installations: [] };
}

it.effect(
  "rename uses the inspected revision and generated operation ID, and writes only after confirmation",
  () =>
    Effect.gen(function* () {
      const calls: unknown[] = [];
      const confirmed: string[] = [];
      const io = testCliContext({
        interactive: true,
        confirm: (message) =>
          Effect.sync(() => {
            confirmed.push(message);
            return true;
          })
      });
      yield* provideTestCli(executeRename(command({ adapter: "fixture" })), io.context, {
        workspace: {
          inspectWorkspace: () => Effect.succeed(inspected()),
          renameWorkspace: (input: unknown, adapter: unknown) =>
            Effect.sync(() => {
              calls.push(input, adapter);
              return { status: RenameStatus.Renamed, revision: "next" };
            })
        },
        ids: ids()
      });
      expect((calls[0] as { expectedRevision: string }).expectedRevision).toBe("observed-revision");
      expect((calls[0] as { operationId: string }).operationId).toBe(operationId);
      expect(calls[1]).toBe("fixture");
      expect(confirmed).toEqual(["Rename record to new-name?"]);
      expect(JSON.parse(io.stdout.join("")).status).toBe(RenameStatus.Renamed);
    })
);

it.effect("an explicit revision skips inspection", () =>
  Effect.gen(function* () {
    let reads = 0;
    const revisions: string[] = [];
    yield* provideTestCli(
      executeRename(command({ expectedRevision: "original" })),
      testCliContext().context,
      {
        workspace: {
          inspectWorkspace: () =>
            Effect.sync(() => {
              reads++;
              return inspected();
            }),
          renameWorkspace: (input: { expectedRevision: string }) =>
            Effect.sync(() => {
              revisions.push(input.expectedRevision);
              return { status: RenameStatus.Renamed };
            })
        },
        ids: ids()
      }
    );
    expect(reads).toBe(0);
    expect(revisions).toEqual(["original"]);
  })
);

it.effect("a failed inspection still reaches recovery with a visible diagnostic", () =>
  Effect.gen(function* () {
    const io = testCliContext();
    const revisions: string[] = [];
    yield* provideTestCli(executeRename(command()), io.context, {
      workspace: {
        inspectWorkspace: () => Effect.fail(new Error("Interrupted directory layout")),
        renameWorkspace: (input: { expectedRevision: string }) =>
          Effect.sync(() => {
            revisions.push(input.expectedRevision);
            return { status: RenameStatus.Renamed };
          })
      },
      ids: ids()
    });
    expect(io.stderr.join("")).toContain("Interrupted directory layout");
    expect(revisions).toEqual([RECOVERY_ONLY_REVISION]);
  })
);

it.effect("a declined confirmation never renames", () =>
  Effect.gen(function* () {
    let writes = 0;
    const io = testCliContext({ interactive: true, confirm: () => Effect.succeed(false) });
    const exit = yield* Effect.exit(
      provideTestCli(executeRename(command()), io.context, {
        workspace: {
          inspectWorkspace: () => Effect.succeed(inspected()),
          renameWorkspace: () =>
            Effect.sync(() => {
              writes++;
              return { status: RenameStatus.Renamed };
            })
        },
        ids: ids()
      })
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") expect(Cause.squash(exit.cause)).toBeInstanceOf(Cancelled);
    expect(writes).toBe(0);
  })
);

for (const status of [RenameStatus.Conflict, RenameStatus.RecoveryRequired, RenameStatus.Failed])
  it.effect(`rename reports ${status} after writing the machine result`, () =>
    Effect.gen(function* () {
      const io = testCliContext();
      const exit = yield* Effect.exit(
        provideTestCli(executeRename(command({ expectedRevision: "original" })), io.context, {
          workspace: {
            renameWorkspace: () => Effect.succeed({ status, reason: "synthetic reason" })
          },
          ids: ids()
        })
      );
      expect(io.stdout.join("")).toContain(`"status": "${status}"`);
      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") expect(Cause.squash(exit.cause)).toBeInstanceOf(CliError);
    })
  );
