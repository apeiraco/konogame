import assert from "node:assert/strict";
import { once } from "node:events";
import { type ReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, it } from "@effect/vitest";
import { type Artifact, type ArtifactFile } from "@konogame/contracts";
import { UuidIdService } from "@konogame/infrastructure";
import { Cause, Deferred, Effect, Exit, Fiber, Stream } from "effect";
import { vi } from "vitest";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { artifactFromDirectory, FilesystemSaveStore } from "../save-store/store.ts";

const native = vi.hoisted(() => ({
  readers: [] as ReadStream[],
  rejectedPublication: undefined as undefined | { error: Error; calls: number },
  parents: undefined as undefined | { started(): void; wait: Promise<void>; events: string[] },
  manifest: undefined as undefined | { started(): void; wait: Promise<void>; events: string[] },
  publication: undefined as
    | undefined
    | {
        started(): void;
        wait: Promise<void>;
        events: string[];
        outcomes: { status: string; from: unknown; to: unknown; error?: unknown }[];
      }
}));
vi.mock("node:fs", async (original) => {
  const module = await original<typeof import("node:fs")>();
  return {
    ...module,
    createReadStream: (...args: Parameters<typeof module.createReadStream>) => {
      const stream = module.createReadStream(...args);
      native.readers.push(stream);
      return stream;
    }
  };
});
vi.mock("node:fs/promises", async (original) => {
  const module = await original<typeof import("node:fs/promises")>();
  return {
    ...module,
    mkdir: async (...args: Parameters<typeof module.mkdir>) => {
      const parents = native.parents;
      if (parents && String(args[0]).includes(".pending-")) {
        const options = args[1];
        if (options && typeof options === "object" && options.recursive) {
          parents.events.push("mkdir-started");
          parents.started();
          await parents.wait;
          const result = await module.mkdir(...args);
          parents.events.push("mkdir-finished");
          return result;
        }
      }
      return module.mkdir(...args);
    },
    open: async (...args: Parameters<typeof module.open>) => {
      const handle = await module.open(...args);
      const manifest = native.manifest;
      if (manifest && String(args[0]).endsWith("manifest.json")) {
        manifest.events.push(`open:${String(args[1])}`);
        const close = handle.close;
        handle.close = async () => {
          manifest.events.push("close-started");
          manifest.started();
          await manifest.wait;
          await close();
          manifest.events.push("close-finished");
        };
      }
      return handle;
    },
    rename: async (...args: Parameters<typeof module.rename>) => {
      const rejected = native.rejectedPublication;
      if (rejected) {
        rejected.calls++;
        throw rejected.error;
      }
      native.manifest?.events.push("publish");
      const publication = native.publication;
      if (publication) {
        publication.started();
        await publication.wait;
        try {
          await module.rename(...args);
          publication.outcomes.push({ status: "fulfilled", from: args[0], to: args[1] });
          publication.events.push("publish");
        } catch (error) {
          publication.outcomes.push({ status: "rejected", from: args[0], to: args[1], error });
          publication.events.push("publish-failed");
          throw error;
        }
        return;
      }
      return module.rename(...args);
    },
    rm: async (...args: Parameters<typeof module.rm>) => {
      if (native.parents && String(args[0]).includes(".pending-"))
        native.parents.events.push("cleanup");
      if (native.manifest && String(args[0]).includes(".pending-"))
        native.manifest.events.push("cleanup");
      if (native.publication && String(args[0]).includes(".pending-"))
        native.publication.events.push("cleanup");
      return module.rm(...args);
    }
  };
});
const roots: string[] = [];
afterEach(async () => {
  native.rejectedPublication = undefined;
  native.parents = undefined;
  native.manifest = undefined;
  native.publication = undefined;
  native.readers.length = 0;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function directory(topic: string) {
  const root = await createTestDirectory(import.meta.dirname, "unit", "save-store", topic);
  roots.push(root);
  return root;
}
const makeFile = (path: string, parts: string[]): ArtifactFile => ({
  path,
  open: () => Stream.fromIterable(parts.map((part) => Buffer.from(part)))
});

it.live("filesystem stores and reopens multiple streamed files", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("stream"));
    const artifact: Artifact = {
      mediaType: "application/test",
      files: Stream.make(makeFile("slot/a.dat", ["one", "two"]), makeFile("slot/b.dat", ["three"]))
    };
    const store = new FilesystemSaveStore(root, new UuidIdService());
    const reference = yield* store.put(artifact);
    assert.match(
      reference.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    const reopened = yield* store.open(reference);
    const files = yield* Stream.runCollect(reopened.files);
    assert.deepEqual(
      files.map((file) => file.path),
      ["slot/a.dat", "slot/b.dat"]
    );
    const chunks = yield* Stream.runCollect(files[0]!.open());
    assert.equal(Buffer.concat(chunks).toString(), "onetwo");
    assert.equal(
      yield* Effect.promise(() =>
        readFile(join(root, reference.id, "files", "slot", "a.dat"), "utf8")
      ),
      "onetwo"
    );
  })
);

it.live("filesystem rejects traversal paths before committing an artifact", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("traversal"));
    const artifact: Artifact = {
      mediaType: "application/test",
      files: Stream.succeed(makeFile("../escape", ["bad"]))
    };
    const error = yield* Effect.flip(
      new FilesystemSaveStore(root, new UuidIdService()).put(artifact)
    );
    assert.match(error.message, /Unsafe artifact path/);
    assert.deepEqual(yield* Effect.promise(() => readdir(root)), []);
  })
);

it.live("interrupting artifact input releases the output handle and removes pending data", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("cancel-input"));
    const started = yield* Deferred.make<void>();
    let inputClosed = false;
    const id = "01999999-9999-7999-8999-999999999999";
    let calls = 0;
    const nextId = "01999999-9999-7999-8999-999999999998";
    const store = new FilesystemSaveStore(root, {
      uuidV7: () => Effect.sync(() => (++calls === 1 ? id : nextId))
    });
    const file: ArtifactFile = {
      path: "slot/save.bin",
      open: () =>
        Stream.succeed(Buffer.from("partial")).pipe(
          Stream.concat(Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(Stream.drain)),
          Stream.concat(Stream.never),
          Stream.ensuring(
            Effect.sync(() => {
              inputClosed = true;
            })
          )
        )
    };
    const writing = yield* Effect.forkScoped(
      store.put({ mediaType: "application/test", files: Stream.succeed(file) })
    );
    yield* Deferred.await(started);
    yield* Fiber.interrupt(writing);
    assert.equal(inputClosed, true);
    assert.deepEqual(yield* Effect.promise(() => readdir(root)), []);
    const reference = yield* store.put({
      mediaType: "application/test",
      files: Stream.succeed(makeFile("slot/save.bin", ["complete"]))
    });
    assert.equal(reference.id, nextId);
    assert.equal(
      yield* Effect.promise(() =>
        readFile(join(root, reference.id, "files/slot/save.bin"), "utf8")
      ),
      "complete"
    );
  })
);

it.live("taking one file byte chunk closes the native read handle", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("cancel-read"));
    yield* Effect.promise(() => writeFile(join(root, "large.bin"), Buffer.alloc(256 * 1024, 1)));
    const artifact = yield* artifactFromDirectory(root);
    const files = yield* Stream.runCollect(artifact.files);
    const chunks = yield* Stream.runCollect(files[0]!.open().pipe(Stream.take(1)));
    assert.equal(chunks.length, 1);
    const reader = native.readers.at(-1)!;
    assert.equal(reader.destroyed, true);
    if (!reader.closed) yield* Effect.promise(() => once(reader, "close"));
    assert.equal(reader.closed, true);
  })
);

it.live("native publication finishes before cancellation can run staging cleanup", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("cancel-publish"));
    const entered = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];
    const outcomes: NonNullable<typeof native.publication>["outcomes"] = [];
    native.publication = {
      started: () => {
        Deferred.doneUnsafe(entered, Effect.void);
      },
      wait: gate.promise,
      events,
      outcomes
    };
    const store = new FilesystemSaveStore(root, new UuidIdService());
    const writing = yield* Effect.forkScoped(
      store.put({
        mediaType: "application/test",
        files: Stream.succeed(makeFile("slot/save.bin", ["complete"]))
      })
    );
    yield* Deferred.await(entered);
    const interrupting = yield* Effect.forkScoped(Fiber.interrupt(writing), {
      startImmediately: true
    });
    const beforePublication = events.slice();
    gate.resolve();
    yield* Fiber.join(interrupting);
    const exit = yield* Fiber.await(writing);
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ["fulfilled"],
      inspect(outcomes)
    );
    assert.equal(Exit.hasInterrupts(exit), true);
    assert.equal(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
      true,
      Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "Expected interruption"
    );
    assert.deepEqual(beforePublication, []);
    assert.deepEqual(events, ["publish", "cleanup"]);
    const names = yield* Effect.promise(() => readdir(root));
    assert.equal(names.length, 1);
    assert.equal(
      names.some((name) => name.startsWith(".pending-")),
      false
    );
  })
);

it.live("manifest close completes before the store enters publication", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("manifest-close"));
    const entered = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];
    native.manifest = {
      started: () => {
        Deferred.doneUnsafe(entered, Effect.void);
      },
      wait: gate.promise,
      events
    };
    const store = new FilesystemSaveStore(root, new UuidIdService());
    const writing = yield* Effect.forkScoped(
      store.put({
        mediaType: "application/test",
        files: Stream.empty
      })
    );
    yield* Deferred.await(entered);
    const beforeClose = events.slice();
    gate.resolve();
    const reference = yield* Fiber.join(writing);
    assert.deepEqual(beforeClose, ["open:wx", "close-started"]);
    assert.deepEqual(events, ["open:wx", "close-started", "close-finished", "publish"]);
    assert.deepEqual(yield* Effect.promise(() => readdir(root)), [reference.id]);
  })
);

it.live("cancellation waits for manifest close before cleaning staging and never publishes", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("cancel-manifest-close"));
    const entered = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];
    native.manifest = {
      started: () => {
        Deferred.doneUnsafe(entered, Effect.void);
      },
      wait: gate.promise,
      events
    };
    const store = new FilesystemSaveStore(root, new UuidIdService());
    const writing = yield* Effect.forkScoped(
      store.put({
        mediaType: "application/test",
        files: Stream.empty
      })
    );
    yield* Deferred.await(entered);
    const interrupting = yield* Effect.forkScoped(Fiber.interrupt(writing), {
      startImmediately: true
    });
    const beforeClose = events.slice();
    gate.resolve();
    yield* Fiber.join(interrupting);
    const exit = yield* Fiber.await(writing);
    assert.equal(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
      true,
      Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "Expected interruption"
    );
    assert.deepEqual(beforeClose, ["open:wx", "close-started"]);
    assert.deepEqual(events, ["open:wx", "close-started", "close-finished", "cleanup"]);
    assert.deepEqual(yield* Effect.promise(() => readdir(root)), []);
  })
);

it.live("cancellation waits for native parent creation before removing staging", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("cancel-file-parents"));
    const entered = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<void>();
    const events: string[] = [];
    native.parents = {
      started: () => {
        Deferred.doneUnsafe(entered, Effect.void);
      },
      wait: gate.promise,
      events
    };
    const store = new FilesystemSaveStore(root, new UuidIdService());
    const writing = yield* Effect.forkScoped(
      store.put({
        mediaType: "application/test",
        files: Stream.succeed(makeFile("slot/save.bin", ["complete"]))
      })
    );
    yield* Deferred.await(entered);
    const interrupting = yield* Effect.forkScoped(Fiber.interrupt(writing), {
      startImmediately: true
    });
    const beforeCreation = events.slice();
    gate.resolve();
    yield* Fiber.join(interrupting);
    const exit = yield* Fiber.await(writing);
    assert.equal(
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause),
      true,
      Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "Expected interruption"
    );
    assert.deepEqual(beforeCreation, ["mkdir-started"]);
    assert.deepEqual(events, ["mkdir-started", "mkdir-finished", "cleanup"]);
    assert.deepEqual(yield* Effect.promise(() => readdir(root)), []);
  })
);

it.live(
  "a refused native publication removes owned staging and preserves the original error and other data",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() => directory("exhausted-publication"));
      yield* Effect.promise(() => writeFile(join(root, "unrelated.txt"), "preserve"));
      // EACCES is not retried. The Windows EPERM schedule is covered with TestClock
      // in the publication policy tests.
      const original = Object.assign(new Error("Synthetic native publication denied"), {
        code: "EACCES",
        syscall: "rename"
      });
      const rejected = { error: original, calls: 0 };
      native.rejectedPublication = rejected;
      const error = yield* Effect.flip(
        new FilesystemSaveStore(root, new UuidIdService()).put({
          mediaType: "application/test",
          files: Stream.succeed(makeFile("slot/save.bin", ["complete"]))
        })
      );
      assert.equal(error.operation, "publish-artifact");
      assert.equal(error.cause, original);
      assert.equal(rejected.calls, 1);
      assert.deepEqual(yield* Effect.promise(() => readdir(root)), ["unrelated.txt"]);
      assert.equal(
        yield* Effect.promise(() => readFile(join(root, "unrelated.txt"), "utf8")),
        "preserve"
      );
    })
);

it.live("an existing publication target remains untouched while only staging is removed", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => directory("publication-conflict"));
    const id = "01999999-9999-7999-8999-999999999999";
    const target = join(root, id);
    yield* Effect.promise(() => mkdir(target));
    yield* Effect.promise(() => writeFile(join(target, "existing.bin"), "preserve"));
    const rejected = { error: new Error("Existing target must prevent native rename"), calls: 0 };
    native.rejectedPublication = rejected;
    const store = new FilesystemSaveStore(root, { uuidV7: () => Effect.succeed(id) });
    const error = yield* Effect.flip(
      store.put({ mediaType: "application/test", files: Stream.empty })
    );
    assert.equal((error.cause as { code: string }).code, "EEXIST");
    assert.equal(rejected.calls, 0);
    assert.deepEqual(yield* Effect.promise(() => readdir(root)), [id]);
    assert.equal(
      yield* Effect.promise(() => readFile(join(target, "existing.bin"), "utf8")),
      "preserve"
    );
  })
);
