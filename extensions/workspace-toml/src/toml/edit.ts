import { isDeepStrictEqual } from "node:util";
import { ConfigurationInputKind } from "@konogame/workspace";
import { type AST } from "toml-eslint-parser";
import { ConfigurationInvalidInputError, parseConfigurationJson } from "../operations/errors.ts";
import { parseConfigurationToml } from "./parser.ts";

interface Patch {
  start: number;
  end: number;
  text: string;
}
type Path = (string | number)[];
interface Pair {
  path: Path;
  node: AST.TOMLKeyValue;
  inline?: AST.TOMLInlineTable;
}
interface Change {
  path: Path;
  value?: unknown;
  remove: boolean;
}
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const starts = (path: Path, prefix: Path) =>
  prefix.length <= path.length && prefix.every((part, index) => part === path[index]);
const equalPath = (left: Path, right: Path) => left.length === right.length && starts(left, right);
const key = (path: Path) => path.map((part) => tomlValue(String(part))).join(".");

export function tomlValue(value: unknown): string {
  if (typeof value === "string") {
    return JSON.stringify(value).replace(
      /[\u007f-\u009f]/g,
      (character) => `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  if (object(value)) {
    return `{ ${Object.entries(value)
      .map(([name, entry]) => `${key([name])} = ${tomlValue(entry)}`)
      .join(", ")} }`;
  }
  throw ConfigurationInvalidInputError.make(
    { kind: ConfigurationInputKind.Value, format: "toml", valueType: typeof value },
    "Unsupported TOML management value"
  );
}

function differences(before: unknown, after: unknown, path: Path = []): Change[] {
  if (
    isDeepStrictEqual(
      parseConfigurationJson(JSON.stringify(before)),
      parseConfigurationJson(JSON.stringify(after))
    )
  ) {
    return [];
  }
  if (object(before) && object(after) && Object.keys(after).length) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((name) => {
      if (!Object.hasOwn(after, name)) {
        return [{ path: [...path, name], remove: true }];
      }
      if (!Object.hasOwn(before, name)) {
        return [{ path: [...path, name], value: after[name], remove: false }];
      }
      return differences(before[name], after[name], [...path, name]);
    });
  }
  return [{ path, value: after, remove: false }];
}

/** Changes only affected TOML tokens; comments and unrelated bytes remain in place. */
export function editConfigurationToml(content: string, after: object): string {
  let current = content;
  // Reparse each logical change so insertions and comma removals never share stale ranges.
  for (const change of differences(parseConfigurationToml(content).data, after)) {
    current = applyChange(current, change);
  }
  const actual = parseConfigurationJson(JSON.stringify(parseConfigurationToml(current).data));
  if (!isDeepStrictEqual(actual, parseConfigurationJson(JSON.stringify(after)))) {
    throw ConfigurationInvalidInputError.make(
      { kind: ConfigurationInputKind.EditSemantics },
      "TOML edit did not preserve the requested record semantics"
    );
  }
  return current;
}

function applyChange(content: string, change: Change): string {
  const { ast } = parseConfigurationToml(content);
  const pairs: Pair[] = [];
  const inlineTables: { path: Path; node: AST.TOMLInlineTable }[] = [];
  const tables: { path: Path; node: AST.TOMLTable }[] = [];
  const visit = (node: AST.TOMLKeyValue, prefix: Path, inline?: AST.TOMLInlineTable) => {
    const path = [
      ...prefix,
      ...node.key.keys.map((part) => (part.type === "TOMLBare" ? part.name : part.value))
    ];
    pairs.push({ path, node, inline });
    if (node.value.type === "TOMLInlineTable") {
      inlineTables.push({ path, node: node.value });
      for (const child of node.value.body) {
        visit(child, path, node.value);
      }
    }
  };
  for (const node of ast.body[0].body) {
    if (node.type === "TOMLKeyValue") {
      visit(node, []);
    } else {
      tables.push({ path: node.resolvedKey, node });
      for (const pair of node.body) {
        visit(pair, node.resolvedKey);
      }
    }
  }
  const patches: Patch[] = [];
  const exact = pairs.find((pair) => equalPath(pair.path, change.path));
  if (!exact) {
    const inlineDescendant = pairs.find((pair) => pair.inline && starts(pair.path, change.path));
    if (inlineDescendant) {
      return applyChange(
        applyChange(content, { path: inlineDescendant.path, remove: true }),
        change
      );
    }
  }
  if (exact && !change.remove) {
    patches.push({
      start: exact.node.value.range[0],
      end: exact.node.value.range[1],
      text: tomlValue(change.value)
    });
  } else {
    // A removed/replaced table keeps its comments as standalone comments.
    const removed = pairs.filter((pair) => starts(pair.path, change.path) && !pair.inline);
    if (exact?.inline) {
      const siblings = exact.inline.body;
      const index = siblings.indexOf(exact.node);
      let start = exact.node.range[0];
      let end = exact.node.range[1];
      if (index < siblings.length - 1) {
        end = siblings[index + 1]!.range[0];
      } else if (index > 0) {
        start = siblings[index - 1]!.range[1];
      }
      patches.push({ start, end, text: "" });
    } else {
      for (const pair of removed) {
        patches.push({ start: pair.node.range[0], end: pair.node.range[1], text: "" });
      }
      for (const table of tables.filter((entry) => starts(entry.path, change.path))) {
        // The parsed key range skips brackets and comment markers in quoted key text.
        const headerEnd =
          content.indexOf("]", table.node.key.range[1]) + (table.node.kind === "array" ? 2 : 1);
        patches.push({ start: table.node.range[0], end: headerEnd, text: "" });
      }
    }
    if (!change.remove) {
      const inline = inlineTables
        .filter(
          (entry) => starts(change.path, entry.path) && entry.path.length < change.path.length
        )
        .sort((left, right) => right.path.length - left.path.length)[0];
      if (inline) {
        const position = inline.node.range[1] - 1;
        patches.push({
          start: position,
          end: position,
          text: `${inline.node.body.length ? ", " : " "}${key(change.path.slice(inline.path.length))} = ${tomlValue(change.value)} `
        });
      } else {
        const table = tables
          .filter(
            (entry) => starts(change.path, entry.path) && entry.path.length < change.path.length
          )
          .sort((left, right) => right.path.length - left.path.length)[0];
        const firstTable = tables[0]?.node.range[0] ?? content.length;
        const position = table ? table.node.range[1] : firstTable;
        const newline = content.includes("\r\n") ? "\r\n" : "\n";
        patches.push({
          start: position,
          end: position,
          text: `${position && content[position - 1] !== "\n" ? newline : ""}${key(change.path.slice(table?.path.length ?? 0))} = ${tomlValue(change.value)}${newline}`
        });
      }
    }
  }
  // Comments inside replaced multiline values survive beside their containing field.
  const comments = ast.comments.filter((comment) =>
    patches.some(
      (patch) =>
        patch.end > patch.start && comment.range[0] >= patch.start && comment.range[1] <= patch.end
    )
  );
  if (comments.length) {
    const changedStart = Math.min(
      ...patches.filter((patch) => patch.end > patch.start).map((patch) => patch.start)
    );
    const enclosing = pairs
      .filter(
        (pair) =>
          !pair.inline && pair.node.range[0] <= changedStart && pair.node.range[1] >= changedStart
      )
      .at(0);
    const position = enclosing?.node.range[0] ?? changedStart;
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    patches.push({
      start: position,
      end: position,
      text: comments.map((comment) => content.slice(...comment.range)).join(newline) + newline
    });
  }
  for (const patch of patches.sort(
    (left, right) => right.start - left.start || right.end - left.end
  )) {
    content = content.slice(0, patch.start) + patch.text + content.slice(patch.end);
  }
  parseConfigurationToml(content);
  return content;
}
