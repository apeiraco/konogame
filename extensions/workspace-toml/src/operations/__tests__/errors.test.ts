import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { assertSchema, SchemaValidationError } from "@konogame/infrastructure/contracts";
import { ConfigurationInputKind, ConfigurationValueProblem } from "@konogame/workspace";
import { type } from "arktype";
import { Effect } from "effect";
import { parseConfigurationToml } from "../../toml/parser.ts";
import {
  ConfigurationInvalidInputError,
  configurationRule,
  decodeConfigurationText,
  parseConfigurationJson
} from "../errors.ts";

it.effect(
  "known schema rejections retain their concrete catchTag through the pure-rule bridge",
  () =>
    Effect.gen(function* () {
      const schema = type({ title: "string" });
      const result = yield* configurationRule("record", () =>
        assertSchema("test.record", schema, { title: 3 })
      ).pipe(Effect.catchTag("SchemaValidationError", (error) => Effect.succeed(error)));
      assert.ok(result instanceof SchemaValidationError);
      assert.deepEqual(result.issues[0]?.path, ["title"]);
    })
);
it.effect("syntax positions and JSON-subset rejections are structured input failures", () =>
  Effect.gen(function* () {
    const syntax = yield* Effect.flip(
      configurationRule("parse", parseConfigurationToml, "value = [")
    );
    assert.ok(syntax instanceof ConfigurationInvalidInputError);
    assert.equal(syntax.issue.kind, ConfigurationInputKind.Syntax);
    if (syntax.issue.kind === ConfigurationInputKind.Syntax) {
      assert.equal(syntax.issue.format, "toml");
      assert.equal(typeof syntax.issue.position?.line, "number");
    }
    const subset = yield* Effect.flip(
      configurationRule("parse", parseConfigurationToml, "value = 1979-05-27")
    );
    assert.ok(subset instanceof ConfigurationInvalidInputError);
    assert.deepEqual(subset.issue, {
      kind: ConfigurationInputKind.JsonSubset,
      problem: ConfigurationValueProblem.DateTime
    });
    const json = yield* Effect.flip(configurationRule("parse", parseConfigurationJson, "{"));
    assert.ok(json instanceof ConfigurationInvalidInputError);
    assert.deepEqual(json.issue, { kind: ConfigurationInputKind.Syntax, format: "json" });
  })
);

it.effect("malformed UTF-8 bytes retain the exact invalid-input category and source path", () =>
  Effect.gen(function* () {
    const path = "synthetic/configuration.toml";
    const error = yield* Effect.flip(
      configurationRule("decode", decodeConfigurationText, Uint8Array.of(255), path)
    );
    assert.ok(error instanceof ConfigurationInvalidInputError);
    assert.deepEqual(error.issue, { kind: ConfigurationInputKind.Utf8, path });
  })
);
