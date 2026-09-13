import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { UuidIdService } from "@konogame/infrastructure";
import {
  EditStatus,
  ImportStatus,
  InitializeStatus,
  type WorkspaceConfigurationError
} from "@konogame/workspace";
import { Cause, Deferred, Effect, Exit, Fiber, Logger } from "effect";
import { records } from "../../../../packages/workspace/tests/support/records.ts";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { NodeWorkspaceManagementFileSystem } from "../../src/filesystem/management.ts";
import { NodeWorkspaceFileSystem, WorkspaceFileSystemError } from "../../src/filesystem/node.ts";
import { fixture, locationBehavior, workspaceConfiguration } from "../support/workspace-fixture.ts";

const WorkflowMode = {
  Initialize: "initialize",
  Edit: "edit",
  Import: "import"
} as const;
type WorkflowMode = (typeof WorkflowMode)[keyof typeof WorkflowMode];

class PauseAfterJournal extends NodeWorkspaceManagementFileSystem {
  private paused = false;
  failLockCleanup = false;
  constructor(
    private readonly mode: WorkflowMode,
    private readonly published: Deferred.Deferred<void>
  ) {
    super(new NodeWorkspaceFileSystem(), new UuidIdService());
  }
  override create(path: string, content: string) {
    const self = this;
    return super.create(path, content).pipe(
      Effect.andThen(() =>
        Effect.gen(function* () {
          if (!self.paused && path.replaceAll("\\", "/").endsWith(`${self.mode}/journal.json`)) {
            self.paused = true;
            yield* Deferred.succeed(self.published, undefined);
            yield* Effect.never;
          }
        })
      )
    );
  }
  override remove(path: string) {
    return this.failLockCleanup && path.endsWith("writer.lock")
      ? Effect.fail(
          WorkspaceFileSystemError.from(
            "release-writer-lock",
            "Injected cancellation cleanup failure"
          )
        )
      : super.remove(path);
  }
}

function operation(mode: WorkflowMode, io: PauseAfterJournal) {
  return Effect.gen(function* () {
    const ids = new UuidIdService();
    const operationId = yield* ids.uuidV7();
    const adapter = workspaceConfiguration({
      importFileSystem: io,
      managementFileSystem: io,
      locationBehavior
    });
    if (mode === WorkflowMode.Initialize) {
      const root = yield* Effect.acquireRelease(
        Effect.promise(() =>
          createTestDirectory(import.meta.dirname, "integration", "initialize-cancellation")
        ),
        (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
      );
      const { workspace, host } = records();
      workspace.defaults = {};
      host.gameOverrides = {};
      return {
        root,
        run: Effect.asVoid(adapter.initialize({ root, operationId, workspace, host })),
        recover: () => adapter.recoverInitialize({ root, operationId }),
        expectedStatus: InitializeStatus.Initialized
      };
    }
    const f = yield* Effect.promise(() => fixture());
    const expectedRevision = (yield* f.read()).revision;
    if (mode === WorkflowMode.Edit) {
      return {
        root: f.root,
        run: Effect.asVoid(
          adapter.edit({
            root: f.root,
            operationId,
            expectedRevision,
            change: {
              kind: "metadata.replace",
              target: { kind: "game", recordId: f.game.id },
              metadata: { title: "Cancelled and recovered title" }
            }
          })
        ),
        recover: () => adapter.recoverEdit({ root: f.root, operationId }),
        expectedStatus: EditStatus.Edited
      };
    }
    const game = {
      ...f.game,
      id: yield* ids.uuidV7(),
      uniformName: "Cancelled import",
      title: "Cancelled import"
    };
    const installation = {
      ...f.installation,
      id: yield* ids.uuidV7(),
      gameId: game.id,
      uniformName: "Cancelled imported installation",
      location: {
        type: "fixture.location",
        schemaVersion: "1.0.0",
        data: { key: "cancelled-import" }
      }
    };
    return {
      root: f.root,
      run: Effect.asVoid(
        adapter.import({
          root: f.root,
          operationId,
          expectedRevision,
          games: [game],
          installations: [installation]
        })
      ),
      recover: () => adapter.recoverImport({ root: f.root, operationId }),
      expectedStatus: ImportStatus.Imported
    };
  });
}

it.effect.each(Object.values(WorkflowMode))(
  "%s interruption preserves its approved journal, releases the writer lock, and supports explicit recovery",
  (mode) =>
    Effect.gen(function* () {
      const published = yield* Deferred.make<void>();
      const io = new PauseAfterJournal(mode, published);
      const request = yield* operation(mode, io);
      const writer = yield* request.run.pipe(Effect.forkScoped);
      yield* Deferred.await(published).pipe(
        Effect.raceFirst(
          Fiber.await(writer).pipe(
            Effect.flatMap((exit) =>
              Effect.fail(
                new Error(`Workflow finished before journal publication: ${JSON.stringify(exit)}`)
              )
            )
          )
        )
      );
      yield* Fiber.interrupt(writer);
      const exit = yield* Fiber.await(writer);
      expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
      const base = join(request.root, ".konogame/recovery");
      expect(yield* io.inspect(join(base, `${mode}/journal.json`))).toBe("file");
      expect(yield* io.inspect(join(base, "rename/writer.lock"))).toBeUndefined();
      const recover: () => Effect.Effect<{ status: string }, WorkspaceConfigurationError> =
        request.recover;
      expect((yield* recover()).status).toBe(request.expectedStatus);
      expect(yield* io.inspect(join(base, `${mode}/journal.json`))).toBeUndefined();
    })
);

it.effect(
  "interrupted edit with failed lock cleanup preserves interruption and logs the recovery failure",
  () =>
    Effect.gen(function* () {
      const published = yield* Deferred.make<void>();
      const io = new PauseAfterJournal(WorkflowMode.Edit, published);
      const request = yield* operation(WorkflowMode.Edit, io);
      io.failLockCleanup = true;
      const diagnostics: unknown[] = [];
      const logger = Logger.make((options) => {
        diagnostics.push(options.message);
      });
      const writer = yield* request.run.pipe(
        Effect.provide(Logger.layer([logger])),
        Effect.forkScoped
      );
      yield* Deferred.await(published);
      yield* Fiber.interrupt(writer);
      const exit = yield* Fiber.await(writer);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      }
      expect(JSON.stringify(diagnostics)).toContain("recovery-required");
      expect(JSON.stringify(diagnostics)).toContain("Injected cancellation cleanup failure");
      const base = join(request.root, ".konogame/recovery");
      expect(yield* io.inspect(join(base, "edit/journal.json"))).toBe("file");
      expect(yield* io.inspect(join(base, "rename/writer.lock"))).toBe("file");
    })
);
