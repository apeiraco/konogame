import { type AST, parseTOML } from "toml-eslint-parser";

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
    if (entry === undefined)
      (current as JsonObject)[key] = typeof path[index + 1] === "number" ? [] : object();
    const next: JsonValue | undefined = (current as JsonObject)[key];
    if (!next || typeof next !== "object") throw new Error("Invalid TOML table path");
    current = next;
  }
  (current as JsonObject)[path.at(-1)!] = value;
}

function ensureTable(target: JsonObject, path: (string | number)[]): void {
  let current: JsonObject | JsonValue[] = target;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    if ((current as JsonObject)[key] === undefined)
      (current as JsonObject)[key] = typeof path[index + 1] === "number" ? [] : object();
    const next: JsonValue | undefined = (current as JsonObject)[key];
    if (!next || typeof next !== "object") throw new Error("Invalid TOML table path");
    current = next;
  }
}

function value(node: AST.TOMLContentNode): JsonValue {
  if (node.type === "TOMLArray") return node.elements.map(value);
  if (node.type === "TOMLInlineTable") {
    const result = object();
    for (const pair of node.body) assign(result, keys(pair.key), value(pair.value));
    return result;
  }
  if (node.kind === "integer") {
    if (!Number.isSafeInteger(node.value))
      throw new Error("TOML integer exceeds the JSON safe integer range");
    return node.value;
  }
  if (node.kind === "float") {
    if (!Number.isFinite(node.value))
      throw new Error("TOML non-finite numbers are not JSON values");
    return node.value;
  }
  if (node.kind === "string" || node.kind === "boolean") return node.value;
  throw new Error("TOML date/time values are outside the configuration JSON subset");
}

export function parseConfigurationToml(content: string): {
  data: JsonObject;
  ast: AST.TOMLProgram;
} {
  const ast = parseTOML(content, { tomlVersion: "1.0" });
  const data = object();
  for (const entry of ast.body[0].body) {
    if (entry.type === "TOMLKeyValue") assign(data, keys(entry.key), value(entry.value));
    else {
      // Resolved keys include array-table indices, avoiding a second TOML parser.
      for (const pair of entry.body)
        assign(data, [...entry.resolvedKey, ...keys(pair.key)], value(pair.value));
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
  )
    throw new Error("Expected a root uniformName string token");
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
