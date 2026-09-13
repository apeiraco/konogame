import { rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import { UuidIdService } from "@konogame/infrastructure";
import { Cause, Deferred, Effect, Exit, Fiber, Option } from "effect";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import {
  WorkspaceWriterConflict,
  withWorkspaceWriterLock
} from "../../src/coordination/writer-lock.ts";
import { NodeWorkspaceImportFileSystem } from "../../src/filesystem/import.ts";
import { NodeWorkspaceFileSystem } from "../../src/filesystem/node.ts";

const operationId = "019a0000-0000-7000-8000-000000000001";
function fixture() {
  return Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => createTestDirectory(import.meta.dirname, "integration", "writer-lock")),
      (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
    );
    const node = new NodeWorkspaceFileSystem();
    const ids = new UuidIdService();
    const fileSystem = new NodeWorkspaceImportFileSystem(node, ids);
    yield* fileSystem.mkdir(join(root, "recovery"));
    yield* fileSystem.mkdir(join(root, "recovery/rename"));
    return {
      root,
      node,
      ids,
      fileSystem,
      lockPath: join(root, "recovery/rename/writer.lock")
    };
  });
}

it.effect(
  "a concurrent request with the same operation ID cannot release the first writer lock",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const first = yield* withWorkspaceWriterLock(
        f.fileSystem,
        f.root,
        operationId,
        "import",
        () =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
            return "first";
          })
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(entered);
      class StaleObservationFileSystem extends NodeWorkspaceImportFileSystem {
        private first = true;
        override inspect(path: string) {
          if (path === f.lockPath && this.first) {
            this.first = false;
            return Effect.succeed(undefined);
          }
          return super.inspect(path);
        }
      }
      const secondIo = new StaleObservationFileSystem(f.node, f.ids);
      const second = yield* Effect.exit(
        withWorkspaceWriterLock(secondIo, f.root, operationId, "import", () =>
          Effect.succeed("second")
        )
      );
      expect(Exit.isFailure(second)).toBe(true);
      if (Exit.isFailure(second)) {
        const failure = Cause.findErrorOption(second.cause);
        expect(Option.isSome(failure) && failure.value instanceof WorkspaceWriterConflict).toBe(
          true
        );
      }
      expect(yield* f.fileSystem.inspect(f.lockPath)).toBe("file");
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(first)).toBe("first");
      expect(yield* f.fileSystem.inspect(f.lockPath)).toBeUndefined();
    })
);

it.effect(
  "a defect after exclusive lock publication keeps its cause and releases the owned lock",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const defect = new Error("injected defect after lock publication");
      class DefectAfterCreate extends NodeWorkspaceImportFileSystem {
        override create(path: string, content: string) {
          return super.create(path, content).pipe(Effect.andThen(Effect.die(defect)));
        }
      }
      let actionRan = false;
      const fileSystem = new DefectAfterCreate(f.node, f.ids);
      const exit = yield* Effect.exit(
        withWorkspaceWriterLock(fileSystem, f.root, operationId, "import", () =>
          Effect.sync(() => {
            actionRan = true;
          })
        )
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);
        expect(Cause.squash(exit.cause)).toBe(defect);
      }
      expect(actionRan).toBe(false);
      expect(yield* f.fileSystem.inspect(f.lockPath)).toBeUndefined();
    })
);

it.effect("interruption releases the owned lock while preserving published recovery metadata", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.fileSystem.mkdir(join(f.root, "recovery/import"));
    const journalPath = join(f.root, "recovery/import/journal.json");
    const journal = JSON.stringify({ operationId, approved: true });
    const published = yield* Deferred.make<void>();
    const writer = yield* withWorkspaceWriterLock(f.fileSystem, f.root, operationId, "import", () =>
      Effect.gen(function* () {
        yield* f.fileSystem.create(journalPath, journal);
        yield* Deferred.succeed(published, undefined);
        yield* Effect.never;
      })
    ).pipe(Effect.forkScoped);
    yield* Deferred.await(published);
    yield* Fiber.interrupt(writer);
    const exit = yield* Fiber.await(writer);
    expect(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)).toBe(true);
    expect(yield* f.fileSystem.inspect(f.lockPath)).toBeUndefined();
    expect(yield* f.fileSystem.read(journalPath, 4096)).toBe(journal);
  })
);
