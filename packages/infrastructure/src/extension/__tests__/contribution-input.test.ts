import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { test } from "vitest";
import { extension, moduleContribution, setup } from "../../__tests__/support.ts";
import { type Contribution } from "../contribution.ts";
import {
  ContributionInputStatus,
  decodeContribution,
  identifyContribution
} from "../contribution-input.ts";

test("safe contribution identity never reads getters and reports no identity for hostile objects", () => {
  let reads = 0;
  const input = Object.defineProperty({}, "manifest", {
    get() {
      reads++;
      throw new Error("getter");
    }
  });
  assert.deepEqual(identifyContribution(input), {});
  assert.deepEqual(
    identifyContribution(
      new Proxy(
        {},
        {
          ownKeys() {
            throw new Error("proxy");
          }
        }
      )
    ),
    {}
  );
  assert.equal(reads, 0);
});

it.effect(
  "source refresh parses each candidate once for additions unchanged records and replacements",
  () =>
    Effect.gen(function* () {
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
      const item = extension("single-pass", {
        manifest: {
          contributes: {
            locations: [
              {
                type: "synthetic.single-pass",
                schemaVersion: "1.0.0",
                schemaRange: "^1",
                dataSchema
              }
            ]
          }
        }
      });
      let current = { ...item, revision: "first" };
      const env = yield* setup([], {}, [
        {
          id: "single-pass-source",
          discover: () => Effect.succeed({ complete: true, contributions: [current] })
        }
      ]);
      yield* env.lifecycle.prepared;
      assert.equal(conversions, 1);
      const generation = env.extensions.get("single-pass")!.generation;
      assert.deepEqual((yield* env.lifecycle.refresh()).unchanged, ["single-pass"]);
      assert.equal(conversions, 2);
      assert.equal(env.extensions.get("single-pass")!.generation, generation);
      current = { ...current, revision: "second" };
      assert.deepEqual((yield* env.lifecycle.refresh()).replaced, ["single-pass"]);
      assert.equal(conversions, 3);
      assert.ok(env.extensions.get("single-pass")!.generation > generation);
      assert.deepEqual(
        env.extensions.getLocationType("synthetic.single-pass")!.definition.dataSchema,
        { type: "object" }
      );
      yield* env.lifecycle.register([
        extension("late", {
          manifest: {
            contributes: {
              locations: [
                {
                  type: "synthetic.late",
                  schemaVersion: "1.0.0",
                  schemaRange: "^1",
                  dataSchema
                }
              ]
            }
          }
        })
      ]);
      assert.equal(conversions, 4);
      assert.ok(env.extensions.get("late"));
    })
);

it.effect(
  "malformed Modules remain isolated while valid Module rule failures stop preparation",
  () =>
    Effect.gen(function* () {
      const malformed = { ...moduleContribution("bad"), manifest: { id: "bad" } } as Contribution;
      assert.equal(decodeContribution(malformed).status, ContributionInputStatus.Rejected);
      const env = yield* setup([malformed, extension("accepted")]);
      yield* env.lifecycle.prepared;
      assert.ok(env.extensions.get("accepted"));
      const forbidden = moduleContribution("forbidden");
      forbidden.manifest.contributes = {
        locations: [
          {
            type: "synthetic.forbidden",
            schemaVersion: "1.0.0",
            schemaRange: "^1",
            dataSchema: {}
          }
        ]
      };
      const input = decodeContribution(forbidden);
      assert.equal(input.status, ContributionInputStatus.Rejected);
      assert.ok(input.status === ContributionInputStatus.Rejected && input.fatal);
      const refused = yield* setup([forbidden]);
      assert.ok(Exit.isFailure(yield* Effect.exit(refused.lifecycle.prepared)));
    })
);
