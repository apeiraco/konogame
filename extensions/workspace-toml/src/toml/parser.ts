import { UnexpectedBoundaryError } from "@konogame/infrastructure/contracts";
import { ConfigurationInputKind, ConfigurationValueProblem } from "@konogame/workspace";
import { type AST, ParseError, parseTOML } from "toml-eslint-parser";
import { ConfigurationInvalidInputError } from "../operations/errors.ts";

type JsonValue = string | number | boolean | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
const object = (): JsonObject => Object.create(null) as JsonObject;

function keys(key: AST.TOMLKey): string[] {
  return key.keys.map((part) => (part.type === "TOMLBare" ? part.name : part.value));
}

function assign(
  target: JsonObject | JsonValue[],
  path: (string | number)[],
  value: JsonValue
): void {
  let current = target;
  for (let index = 0; index < path.length - 1; index++) {
    const key = path[index]!;
    const entry = (current as JsonObject)[key];
    if (entry === undefined) {
      (current as JsonObject)[key] = typeof path[index + 1] === "number" ? [] : object();
    }
    const next: JsonValue | undefined = (current as JsonObject)[key];
    if (!next || typeof next !== "object") {
      throw ConfigurationInvalidInputError.make(
        { kind: ConfigurationInputKind.JsonSubset, problem: ConfigurationValueProblem.TablePath },
        "Invalid TOML table path"
      );
    }
    current = next;
  }
  (current as JsonObject)[path.at(-1)!] = value;
}

function ensureTable(target: JsonObject, path: (string | number)[]): void {
  let current: JsonObject | JsonValue[] = target;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    if ((current as JsonObject)[key] === undefined) {
      (current as JsonObject)[key] = typeof path[index + 1] === "number" ? [] : object();
    }
    const next: JsonValue | undefined = (current as JsonObject)[key];
    if (!next || typeof next !== "object") {
      throw ConfigurationInvalidInputError.make(
        { kind: ConfigurationInputKind.JsonSubset, problem: ConfigurationValueProblem.TablePath },
        "Invalid TOML table path"
      );
    }
    current = next;
  }
}

function value(node: AST.TOMLContentNode): JsonValue {
  if (node.type === "TOMLArray") {
    return node.elements.map(value);
  }
  if (node.type === "TOMLInlineTable") {
    const result = object();
    for (const pair of node.body) {
      assign(result, keys(pair.key), value(pair.value));
    }
    return result;
  }
  if (node.kind === "integer") {
    if (!Number.isSafeInteger(node.value)) {
      throw ConfigurationInvalidInputError.make(
        {
          kind: ConfigurationInputKind.JsonSubset,
          problem: ConfigurationValueProblem.UnsafeInteger
        },
        "TOML integer exceeds the JSON safe integer range"
      );
    }
    return node.value;
  }
  if (node.kind === "float") {
    if (!Number.isFinite(node.value)) {
      throw ConfigurationInvalidInputError.make(
        { kind: ConfigurationInputKind.JsonSubset, problem: ConfigurationValueProblem.NonFinite },
        "TOML non-finite numbers are not JSON values"
      );
    }
    return node.value;
  }
  if (node.kind === "string" || node.kind === "boolean") {
    return node.value;
  }
  throw ConfigurationInvalidInputError.make(
    { kind: ConfigurationInputKind.JsonSubset, problem: ConfigurationValueProblem.DateTime },
    "TOML date/time values are outside the configuration JSON subset"
  );
}

export function parseConfigurationToml(content: string): {
  data: JsonObject;
  ast: AST.TOMLProgram;
} {
  let ast: AST.TOMLProgram;
  try {
    ast = parseTOML(content, { tomlVersion: "1.0" });
  } catch (error) {
    if (error instanceof ParseError) {
      throw ConfigurationInvalidInputError.make(
        {
          kind: ConfigurationInputKind.Syntax,
          format: "toml",
          position: { line: error.lineNumber, column: error.column, offset: error.index }
        },
        error.message
      );
    }
    throw new UnexpectedBoundaryError({
      boundary: "configuration.toml-parser",
      message: error instanceof Error ? error.message : String(error),
      cause: error
    });
  }
  const data = object();
  for (const entry of ast.body[0].body) {
    if (entry.type === "TOMLKeyValue") {
      assign(data, keys(entry.key), value(entry.value));
    } else {
      // Resolved keys include array-table indices, avoiding a second TOML parser.
      for (const pair of entry.body) {
        assign(data, [...entry.resolvedKey, ...keys(pair.key)], value(pair.value));
      }
      ensureTable(data, entry.resolvedKey);
    }
  }
  return { data, ast };
}

export function replaceUniformName(content: string, uniformName: string): string {
  const { ast } = parseConfigurationToml(content);
  const pair = ast.body[0].body.find(
    (entry) =>
      entry.type === "TOMLKeyValue" &&
      keys(entry.key).length === 1 &&
      keys(entry.key)[0] === "uniformName"
  );
  if (
    pair?.type !== "TOMLKeyValue" ||
    pair.value.type !== "TOMLValue" ||
    pair.value.kind !== "string"
  ) {
    throw ConfigurationInvalidInputError.make(
      { kind: ConfigurationInputKind.Value, format: "toml", valueType: "uniformName-token" },
      "Expected a root uniformName string token"
    );
  }
  // JSON basic string escapes are valid TOML after replacing JSON's short form backspace.
  const token = JSON.stringify(uniformName)
    .replace(
      /[\u007f-\u009f]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`
    )
    .replace(/\\u([0-9a-f]{4})/gi, (_, code: string) => `\\u${code.toUpperCase()}`);
  const result = content.slice(0, pair.value.range[0]) + token + content.slice(pair.value.range[1]);
  parseConfigurationToml(result);
  return result;
}
