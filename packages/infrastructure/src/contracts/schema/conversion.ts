import { jsonSchemaToType } from "@ark/json-schema";
import { type JsonSchema, type Type, type } from "arktype";

export { type JsonSchema };

export interface StandardSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => unknown;
  };
}

// Boolean JSON Schema is the unconstrained/impossible document form.
export type ExternalSchema = StandardSchema | JsonSchema | boolean;

const standardPropsSchema = type({
  version: "1",
  vendor: "string",
  validate: "Function"
});
const arkTypeMethodSchema = type({ toJsonSchema: "Function" });
const emptyJsonSchema = type("object").narrow(
  (value, ctx) => Object.keys(value).length === 0 || ctx.mustBe("an empty JSON Schema")
);

// Validate only the `~standard` props. Passing an arktype Type through an object schema re-enters
// its Standard Schema hook.
export const standardSchemaSchema = type.unknown.narrow((value, ctx): value is StandardSchema => {
  try {
    if (value === null || value === undefined) {
      return ctx.mustBe("a Standard Schema");
    }
    return (
      !(standardPropsSchema(Reflect.get(value, "~standard")) instanceof type.errors) ||
      ctx.mustBe("a Standard Schema")
    );
  } catch {
    return ctx.mustBe("a Standard Schema");
  }
});

export function isStandardSchema(value: unknown): value is StandardSchema {
  return !(standardSchemaSchema(value) instanceof type.errors);
}

function isArkTypeSchema(schema: StandardSchema): schema is StandardSchema & Type {
  return (
    schema["~standard"].vendor === "arktype" &&
    !(
      arkTypeMethodSchema({ toJsonSchema: Reflect.get(schema, "toJsonSchema") }) instanceof
      type.errors
    )
  );
}

// ArkType schemas stay intact so transmission keeps their structure. Other Standard Schemas become
// predicates, and JSON Schema is compiled by @ark/json-schema.
export function toInternalSchema(schema: ExternalSchema): Type {
  if (isStandardSchema(schema)) {
    return isArkTypeSchema(schema) ? (schema as never as Type) : (type(schema as never) as Type);
  }
  return jsonSchemaToType(emptyJsonSchema(schema) instanceof type.errors ? schema : true) as Type;
}

export function toTransmittedSchema(schema: Type): JsonSchema {
  return schema.toJsonSchema({
    target: "draft-2020-12",
    fallback: {
      predicate: (ctx) => ctx.base,
      default: (ctx) => ctx.base
    }
  });
}

export function implementationSchema<T>(
  methods: readonly string[],
  mode: "all" | "any" = "all"
): (value: unknown) => value is T {
  const alternatives = methods.map((method) => type({ [method]: "Function" }));
  const schema =
    mode === "any"
      ? alternatives.length === 1
        ? alternatives[0]!
        : type.or(...(alternatives as [Type, Type, ...Type[]]))
      : type(Object.fromEntries(methods.map((method) => [method, "Function"])));
  return (value): value is T => !(schema(value) instanceof type.errors);
}
