import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { type ArtifactPublicationIO, publishArtifact } from "../save-store/publication.ts";

const nativeError = (code: string) =>
  Object.assign(new Error(`Native rename: ${code}`), {
    code,
    syscall: "rename",
    path: "staging",
    dest: "published"
  });
const missing = () =>
  Promise.reject(Object.assign(new Error("Missing target"), { code: "ENOENT" }));

it.effect("Windows EPERM retries follow the native clock and publish on the third attempt", () =>
  Effect.gen(function* () {
    const observed = [
      yield* Deferred.make<void>(),
      yield* Deferred.make<void>(),
      yield* Deferred.make<void>()
    ];
    const objects = new Set(["staging"]);
    let calls = 0;
    let inspections = 0;
    const io: ArtifactPublicationIO = {
      platform: "win32",
      lstat: () => {
        inspections++;
        return missing();
      },
      rename: (source, target) => {
        const attempt = calls++;
        Deferred.doneUnsafe(observed[attempt]!, Effect.void);
        if (attempt < 2) return Promise.reject(nativeError("EPERM"));
        objects.delete(source);
        objects.add(target);
        return Promise.resolve();
      }
    };
    const writing = yield* Effect.forkScoped(publishArtifact("staging", "published", io));
    yield* Deferred.await(observed[0]!);
    yield* TestClock.adjust("24 millis");
    assert.equal(calls, 1);
    yield* TestClock.adjust("1 millis");
    yield* Deferred.await(observed[1]!);
    yield* TestClock.adjust("49 millis");
    assert.equal(calls, 2);
    yield* TestClock.adjust("1 millis");
    yield* Fiber.join(writing);
    assert.equal(calls, 3);
    assert.equal(inspections, 3);
    assert.deepEqual([...objects], ["published"]);
  })
);

it.effect("exhaustion makes five attempts and preserves the last native cause", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const errors = Array.from({ length: 5 }, () => nativeError("EPERM"));
    let calls = 0;
    const writing = yield* Effect.forkScoped(
      Effect.flip(
        publishArtifact("staging", "published", {
          platform: "win32",
          lstat: missing,
          rename: () => {
            Deferred.doneUnsafe(entered, Effect.void);
            return Promise.reject(errors[calls++]);
          }
        })
      )
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust("375 millis");
    const error = yield* Fiber.join(writing);
    assert.equal(calls, 5);
    assert.equal(error.operation, "publish-artifact");
    assert.equal(error.cause, errors[4]);
  })
);

it.effect("unobserved system codes and non-Windows EPERM fail without retry", () =>
  Effect.gen(function* () {
    for (const [platform, code] of [
      ["win32", "EBUSY"],
      ["win32", "EACCES"],
      ["win32", "ENOENT"],
      ["win32", "EXDEV"],
      ["win32", "EEXIST"],
      ["win32", "ENOTEMPTY"],
      ["linux", "EPERM"]
    ]) {
      const original = nativeError(code!);
      let calls = 0;
      const error = yield* Effect.flip(
        publishArtifact("staging", "published", {
          platform: platform!,
          lstat: missing,
          rename: () => {
            calls++;
            return Promise.reject(original);
          }
        })
      );
      assert.equal(calls, 1);
      assert.equal(error.cause, original);
    }
  })
);

it.effect("lstat treats every existing target including dangling links as a conflict", () =>
  Effect.gen(function* () {
    for (const kind of ["file", "directory", "dangling-symlink"]) {
      let calls = 0;
      const existing = { kind, content: "preserve" };
      const error = yield* Effect.flip(
        publishArtifact("staging", "published", {
          platform: "win32",
          lstat: () => Promise.resolve(existing),
          rename: () => {
            calls++;
            return Promise.resolve();
          }
        })
      );
      assert.equal(calls, 0);
      assert.equal((error.cause as { code: string }).code, "EEXIST");
      assert.equal(existing.content, "preserve");
    }
  })
);

it.effect("failed target inspection is not classified as a retryable rename", () =>
  Effect.gen(function* () {
    const original = nativeError("EPERM");
    let calls = 0;
    const error = yield* Effect.flip(
      publishArtifact("staging", "published", {
        platform: "win32",
        lstat: () => Promise.reject(original),
        rename: () => {
          calls++;
          return Promise.resolve();
        }
      })
    );
    assert.equal(calls, 0);
    assert.equal(error.operation, "inspect-publication-target");
    assert.equal(error.cause, original);
  })
);

it.effect("a target created during backoff stops publication without replacing it", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    let calls = 0;
    let targetExists = false;
    const writing = yield* Effect.forkScoped(
      Effect.flip(
        publishArtifact("staging", "published", {
          platform: "win32",
          lstat: () => (targetExists ? Promise.resolve({ content: "preserve" }) : missing()),
          rename: () => {
            calls++;
            Deferred.doneUnsafe(entered, Effect.void);
            return Promise.reject(nativeError("EPERM"));
          }
        })
      )
    );
    yield* Deferred.await(entered);
    targetExists = true;
    yield* TestClock.adjust("25 millis");
    const error = yield* Fiber.join(writing);
    assert.equal(calls, 1);
    assert.equal((error.cause as { code: string }).code, "EEXIST");
    assert.equal(targetExists, true);
  })
);

it.effect("a retry delayed beyond the total 500ms window never starts another rename", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<void>();
    const original = nativeError("EPERM");
    let calls = 0;
    const writing = yield* Effect.forkScoped(
      Effect.flip(
        publishArtifact("staging", "published", {
          platform: "win32",
          lstat: missing,
          rename: () => {
            calls++;
            Deferred.doneUnsafe(entered, Effect.void);
            return gate.promise;
          }
        })
      )
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust("490 millis");
    gate.reject(original);
    yield* TestClock.adjust("25 millis");
    const error = yield* Fiber.join(writing);
    assert.equal(calls, 1);
    assert.equal(error.cause, original);
  })
);

it.effect("a slow retry lstat is checked again before issuing native rename", () =>
  Effect.gen(function* () {
    const first = yield* Deferred.make<void>();
    const inspecting = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<unknown>();
    const original = nativeError("EPERM");
    let calls = 0;
    let inspections = 0;
    const writing = yield* Effect.forkScoped(
      Effect.flip(
        publishArtifact("staging", "published", {
          platform: "win32",
          lstat: () => {
            if (++inspections === 1) return missing();
            Deferred.doneUnsafe(inspecting, Effect.void);
            return gate.promise;
          },
          rename: () => {
            calls++;
            Deferred.doneUnsafe(first, Effect.void);
            return Promise.reject(original);
          }
        })
      )
    );
    yield* Deferred.await(first);
    yield* TestClock.adjust("25 millis");
    yield* Deferred.await(inspecting);
    yield* TestClock.adjust("500 millis");
    gate.reject(Object.assign(new Error("Missing"), { code: "ENOENT" }));
    const error = yield* Fiber.join(writing);
    assert.equal(calls, 1);
    assert.equal(inspections, 2);
    assert.equal(error.cause, original);
  })
);

it.effect("cancellation during backoff prevents further attempts", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    let calls = 0;
    const writing = yield* Effect.forkScoped(
      publishArtifact("staging", "published", {
        platform: "win32",
        lstat: missing,
        rename: () => {
          calls++;
          Deferred.doneUnsafe(entered, Effect.void);
          return Promise.reject(nativeError("EPERM"));
        }
      })
    );
    yield* Deferred.await(entered);
    yield* TestClock.adjust("10 millis");
    yield* Fiber.interrupt(writing);
    const exit = yield* Fiber.await(writing);
    assert.equal(Exit.hasInterrupts(exit), true);
    yield* TestClock.adjust("1 second");
    assert.equal(calls, 1);
  })
);

it.effect("cancellation waits for a native rename to settle before releasing staging", () =>
  Effect.gen(function* () {
    for (const reject of [false, true]) {
      const entered = yield* Deferred.make<void>();
      const gate = Promise.withResolvers<void>();
      const events: string[] = [];
      let calls = 0;
      const writing = yield* Effect.forkScoped(
        publishArtifact("staging", "published", {
          platform: "win32",
          lstat: missing,
          rename: async () => {
            calls++;
            events.push("rename-started");
            Deferred.doneUnsafe(entered, Effect.void);
            try {
              await gate.promise;
            } finally {
              events.push("rename-settled");
            }
          }
        }).pipe(
          Effect.onExit(() =>
            Effect.sync(() => {
              events.push("release");
            })
          )
        )
      );
      yield* Deferred.await(entered);
      const interrupting = yield* Effect.forkScoped(Fiber.interrupt(writing), {
        startImmediately: true
      });
      const beforeSettle = events.slice();
      if (reject) gate.reject(nativeError("EPERM"));
      else gate.resolve();
      yield* Fiber.join(interrupting);
      const exit = yield* Fiber.await(writing);
      assert.equal(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause), true);
      assert.equal(calls, 1);
      assert.deepEqual(beforeSettle, ["rename-started"]);
      assert.deepEqual(events, ["rename-started", "rename-settled", "release"]);
    }
  })
);
it.effect("the first attempt remains allowed after a slow initial target inspection", () =>
  Effect.gen(function* () {
    const inspecting = yield* Deferred.make<void>();
    const gate = Promise.withResolvers<unknown>();
    let calls = 0;
    const writing = yield* Effect.forkScoped(
      publishArtifact("staging", "published", {
        platform: "win32",
        lstat: () => {
          Deferred.doneUnsafe(inspecting, Effect.void);
          return gate.promise;
        },
        rename: () => {
          calls++;
          return Promise.resolve();
        }
      })
    );
    yield* Deferred.await(inspecting);
    yield* TestClock.adjust("600 millis");
    gate.reject(Object.assign(new Error("Missing"), { code: "ENOENT" }));
    yield* Fiber.join(writing);
    assert.equal(calls, 1);
  })
);
