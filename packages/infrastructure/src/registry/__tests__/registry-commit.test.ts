import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit, Fiber, Stream } from "effect";
import { drain, extension, setup } from "../../__tests__/support.ts";
import { ActivationStatus } from "../../index.ts";

it.effect(
  "invalid declarations reject atomically without consuming generations or changing either catalog",
  () =>
    Effect.gen(function* () {
      const env = yield* setup([extension("existing")]);
      yield* env.lifecycle.prepared;
      const before = env.extensions.snapshot,
        adapterBefore = env.adapters.snapshot,
        version = env.extensions.catalogVersion;
      const valid = extension("candidate");
      for (const invalid of [
        null,
        {},
        { kind: "extension" },
        { ...valid, load: 4 },
        { ...valid, typo: true },
        { ...valid, revision: 4 },
        { ...valid, reloadPolicy: "reload" },
        { ...valid, manifest: { ...valid.manifest, software: { game: 4 } } },
        { ...valid, manifest: { ...valid.manifest, contributes: { unknownPoint: [] } } }
      ]) {
        assert.ok(
          Exit.isFailure(
            yield* Effect.exit(env.extensions.registerAll([extension("staged"), invalid]))
          )
        );
        assert.equal(env.extensions.snapshot, before);
        assert.equal(env.adapters.snapshot, adapterBefore);
        assert.equal(env.extensions.catalogVersion, version);
        assert.ok(Exit.isFailure(yield* Effect.exit(env.extensions.replace(invalid))));
        assert.equal(env.extensions.snapshot, before);
      }
      yield* env.extensions.register(valid);
      assert.equal(env.extensions.get("candidate")!.generation, before[0]!.generation + 1);
    })
);

it.effect("all public streams observe matching committed indexes and snapshots", () =>
  Effect.gen(function* () {
    const env = yield* setup();
    yield* env.lifecycle.prepared;
    let observations = 0;
    const check = Effect.sync(() => {
      observations++;
      assert.equal(env.adapters.catalogVersion, env.extensions.catalogVersion);
      assert.deepEqual(
        env.adapters.descriptors(),
        env.adapters.snapshot.map((entry) => entry.descriptor)
      );
      for (const adapter of env.adapters.snapshot) {
        const source = env.extensions.get(adapter.contributionId)!;
        assert.equal(adapter.generation, source.generation);
        assert.equal(adapter.catalogVersion, source.catalogVersion);
        assert.equal(adapter.activation, source.activation);
      }
    });
    yield* Effect.forkScoped(
      Stream.runForEach(
        Stream.mergeAll(
          [
            env.extensions.state$.pipe(Stream.map(() => undefined)),
            env.extensions.results$.pipe(Stream.map(() => undefined)),
            env.adapters.state$.pipe(Stream.map(() => undefined)),
            env.adapters.results$.pipe(Stream.map(() => undefined))
          ],
          { concurrency: "unbounded" }
        ),
        () => check
      ),
      { startImmediately: true }
    );
    yield* env.extensions.register(extension("synthetic"));
    yield* drain;
    yield* env.extensions.replace(extension("synthetic", { priority: 9 }));
    yield* drain;
    const entry = env.extensions.get("synthetic")!;
    yield* env.extensions.markActivation(
      entry.id,
      entry.generation,
      ActivationStatus.Blocked,
      "synthetic"
    );
    yield* drain;
    yield* env.extensions.remove("synthetic");
    yield* drain;
    assert.ok(observations >= 10);
  })
);

it.effect("stream reentry cannot publish an older catalog over a newer revision", () =>
  Effect.gen(function* () {
    const env = yield* setup();
    yield* env.lifecycle.prepared;
    const versions: number[] = [];
    const observer = yield* Effect.forkScoped(
      Stream.runForEach(env.extensions.state$, (snapshot) => {
        if (!snapshot.length) {
          return Effect.void;
        }
        versions.push(snapshot[0]!.catalogVersion);
        return snapshot[0]!.catalogVersion === 1
          ? env.extensions.replace(extension("synthetic", { priority: 9 })).pipe(Effect.asVoid)
          : Effect.void;
      }),
      { startImmediately: true }
    );
    yield* env.extensions.register(extension("synthetic"));
    yield* drain;
    assert.deepEqual(versions, [1, 2]);
    assert.equal(env.adapters.snapshot[0]!.descriptor.priority, 9);
    yield* Fiber.interrupt(observer);
  })
);

it.effect("direct registry arrays reject getters proxies and sparse lengths before traversal", () =>
  Effect.gen(function* () {
    const env = yield* setup();
    yield* env.lifecycle.prepared;
    let reads = 0;
    const getter = Object.defineProperty([extension("getter")], "0", {
      enumerable: true,
      get() {
        reads++;
        throw new Error("getter");
      }
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy");
        }
      }
    );
    const manifestGetter = extension("getter");
    Object.defineProperty(manifestGetter.manifest, "id", {
      enumerable: true,
      get() {
        reads++;
        throw new Error("manifest getter");
      }
    });
    for (const invalid of [getter, new Array(2 ** 30), [proxy], [manifestGetter]]) {
      assert.ok(Exit.isFailure(yield* Effect.exit(env.extensions.registerAll(invalid))));
      assert.equal(env.extensions.catalogVersion, 0);
    }
    assert.equal(reads, 0);
  })
);

it.effect(
  "raw registration parses each declaration once before committing catalog relationships",
  () =>
    Effect.gen(function* () {
      const env = yield* setup();
      yield* env.lifecycle.prepared;
      let conversions = 0;
      const dataSchema = {
        "~standard": {
          version: 1 as const,
          vendor: "arktype",
          validate: (value: unknown) => ({ value })
        },
        toJsonSchema() {
          conversions++;
          return { type: "object" };
        }
      };
      const contribution = (id: string) =>
        extension(id, {
          manifest: {
            contributes: {
              locations: [
                {
                  type: `synthetic.${id}`,
                  schemaVersion: "1.0.0",
                  schemaRange: "^1.0.0",
                  dataSchema
                }
              ]
            }
          }
        });
      yield* env.extensions.register(contribution("registered"));
      assert.equal(conversions, 1);
      yield* env.extensions.registerAll([
        contribution("batch-first"),
        contribution("batch-second")
      ]);
      assert.equal(conversions, 3);
      yield* env.extensions.replace(contribution("registered"));
      assert.equal(conversions, 4);
      yield* env.extensions.replace(contribution("new-entry"));
      assert.equal(conversions, 5);
      assert.deepEqual(
        env.extensions.getLocationType("synthetic.new-entry")!.definition.dataSchema,
        { type: "object" }
      );
      yield* env.extensions.register(extension("unrelated"));
      assert.equal(conversions, 5);
    })
);
