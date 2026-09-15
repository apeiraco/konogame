import { resolve } from "node:path";
import { print } from "esrap";
import ts from "esrap/languages/ts";
import MagicString from "magic-string";
import {
  type ArrowFunctionExpression,
  type Comment,
  type Function as FunctionNode,
  type Node,
  parseSync,
  visitorKeys
} from "oxc-parser";
import { type Plugin } from "vite";

// These usage values and cleanup method belong to the official Preact React integration.
const SIGNALS_IMPORT_SOURCE = "@preact/signals-react/runtime";
const SIGNALS_USAGE = { component: 1, hook: 2 } as const;
type TrackedFunction = ArrowFunctionExpression | FunctionNode;

interface FunctionReview {
  readonly node: TrackedFunction;
  readonly name: string | undefined;
  readonly hookCallback: boolean;
  readonly optedOut: boolean;
  readonly optedIn: boolean;
  hasValue: boolean;
  hasJsx: boolean;
}

function isFunction(node: Node): node is TrackedFunction {
  return (
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression"
  );
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "type" in value;
}

function children(node: Node): Node[] {
  const fields = node as unknown as Record<string, unknown>;
  return (visitorKeys[node.type] ?? []).flatMap((key) => {
    const value = fields[key];
    return Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [];
  });
}

function propertyName(node: Node): string | undefined {
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  return undefined;
}

function isHook(name: string | undefined): boolean {
  return name !== undefined && /^use[A-Z]/.test(name);
}

function isComponent(name: string | undefined): boolean {
  return name !== undefined && /^[A-Z]/.test(name);
}

function functionName(node: TrackedFunction, ancestors: Node[], id: string): string | undefined {
  if (node.id) {
    return node.id.name;
  }
  for (const parent of ancestors.toReversed()) {
    if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier") {
      return parent.id.name;
    }
    if (parent.type === "Property") {
      return propertyName(parent.key);
    }
    if (parent.type === "AssignmentExpression") {
      return parent.left.type === "MemberExpression"
        ? propertyName(parent.left.property)
        : propertyName(parent.left);
    }
    if (parent.type === "ExportDefaultDeclaration") {
      return id.split(/[\\/]/).at(-1);
    }
    if (
      parent.type !== "CallExpression" &&
      parent.type !== "ParenthesizedExpression" &&
      parent.type !== "TSAsExpression" &&
      parent.type !== "TSSatisfiesExpression"
    ) {
      break;
    }
  }
  return undefined;
}

function hasAnnotation(
  code: string,
  comments: Comment[],
  node: Node,
  ancestors: Node[],
  annotation: RegExp
): boolean {
  for (const target of [node, ...ancestors.toReversed()]) {
    if (
      target.type === "BlockStatement" ||
      target.type === "Program" ||
      (isFunction(target) && target !== node)
    ) {
      break;
    }
    if (
      comments.some(
        (comment) =>
          comment.end <= target.start &&
          code.slice(comment.end, target.start).trim() === "" &&
          annotation.test(comment.value)
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Print only added nodes: the original TSX, comments and positions stay intact. */
function emit(source: string): string {
  return print(parseSync("signals-injection.js", source).program, ts({ quotes: "double" })).code;
}

/** Follow the official React transform's automatic component/hook ownership rules. */
export function transformSignals(code: string, id: string) {
  const parsed = parseSync(id, code, { sourceType: "module", preserveParens: true });
  if (parsed.errors.length > 0) {
    throw new SyntaxError(`${id}: ${parsed.errors.map((error) => error.message).join("; ")}`);
  }
  const functions: FunctionReview[] = [];
  const names = new Set<string>();
  const explicitTracking = new Set<string>();
  for (const statement of parsed.program.body) {
    if (
      statement.type !== "ImportDeclaration" ||
      statement.source.value !== SIGNALS_IMPORT_SOURCE
    ) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (
        specifier.type === "ImportSpecifier" &&
        propertyName(specifier.imported) === "useSignals"
      ) {
        explicitTracking.add(specifier.local.name);
      }
    }
  }

  function visit(node: Node, ancestors: Node[], stack: FunctionReview[]) {
    if (node.type === "Identifier") {
      names.add(node.name);
    }
    let currentStack = stack;
    if (isFunction(node)) {
      const parent = ancestors.at(-1);
      const callee = parent?.type === "CallExpression" ? parent.callee : undefined;
      const calleeName =
        callee?.type === "MemberExpression"
          ? propertyName(callee.property)
          : callee && propertyName(callee);
      const review: FunctionReview = {
        node,
        name: functionName(node, ancestors, id),
        hookCallback: isHook(calleeName),
        optedOut: hasAnnotation(
          code,
          parsed.comments,
          node,
          ancestors,
          /(?:^|\s)@no(?:Use|Track)Signals(?:\s|$)/
        ),
        optedIn: hasAnnotation(
          code,
          parsed.comments,
          node,
          ancestors,
          /(?:^|\s)@(?:use|track)Signals(?:\s|$)/
        ),
        hasValue: false,
        hasJsx: false
      };
      functions.push(review);
      currentStack = [...stack, review];
    }
    const hasValue =
      (node.type === "MemberExpression" && propertyName(node.property) === "value") ||
      (node.type === "ObjectPattern" &&
        node.properties.some(
          (property) => property.type === "Property" && propertyName(property.key) === "value"
        ));
    const hasJsx = node.type === "JSXElement" || node.type === "JSXFragment";
    if (hasValue || hasJsx) {
      for (const candidate of currentStack.toReversed()) {
        if (isComponent(candidate.name) || isHook(candidate.name)) {
          candidate.hasValue ||= hasValue;
          candidate.hasJsx ||= hasJsx;
          break;
        }
        // Hook callbacks execute separately from render and cannot own React hooks.
        if (candidate.hookCallback) {
          break;
        }
      }
    }
    for (const child of children(node)) {
      visit(child, [...ancestors, node], currentStack);
    }
  }
  visit(parsed.program, [], []);

  function freshName(base: string) {
    let name = base;
    let suffix = 0;
    while (names.has(name)) {
      name = `${base}${++suffix}`;
    }
    names.add(name);
    return name;
  }

  const selected = functions.filter(({ node, name, hasValue, hasJsx, optedIn, optedOut }) => {
    if (!node.body || node.async || node.generator || optedOut) {
      return false;
    }
    if (
      node.body.type === "BlockStatement" &&
      node.body.body.some((statement) => {
        if (statement.type === "VariableDeclaration") {
          return statement.declarations.some(
            (declaration) =>
              declaration.init?.type === "CallExpression" &&
              declaration.init.callee.type === "Identifier" &&
              explicitTracking.has(declaration.init.callee.name)
          );
        }
        return (
          statement.type === "ExpressionStatement" &&
          statement.expression.type === "CallExpression" &&
          statement.expression.callee.type === "Identifier" &&
          explicitTracking.has(statement.expression.callee.name)
        );
      })
    ) {
      return false;
    }
    return optedIn || (hasValue && (isHook(name) || (isComponent(name) && hasJsx)));
  });
  if (selected.length === 0) {
    return null;
  }

  const output = new MagicString(code);
  const hookName = freshName("_useSignals");
  for (const { node, name } of selected) {
    const body = node.body;
    if (!body) {
      continue;
    }
    const scopeName = freshName("_signalScope");
    const prelude = emit(
      `const ${scopeName} = ${hookName}(${isHook(name) ? SIGNALS_USAGE.hook : SIGNALS_USAGE.component});`
    );
    const cleanup = emit(`${scopeName}.f();`);
    if (body.type === "BlockStatement") {
      let start = body.start + 1;
      for (const statement of body.body) {
        if (statement.type !== "ExpressionStatement" || !("directive" in statement)) {
          break;
        }
        start = statement.end;
      }
      output.appendLeft(start, `\n${prelude}\ntry {`);
      output.appendLeft(body.end - 1, `\n} finally {\n${cleanup}\n}\n`);
    } else {
      output.appendLeft(body.start, `{\n${prelude}\ntry { return (`);
      output.appendLeft(body.end, `);\n} finally {\n${cleanup}\n}\n}`);
    }
  }
  // Preserve directives and hashbangs at the head of a module.
  let importAt = parsed.program.hashbang?.end ?? 0;
  for (const statement of parsed.program.body) {
    if (statement.type !== "ExpressionStatement" || !("directive" in statement)) {
      break;
    }
    importAt = statement.end;
  }
  output.appendLeft(
    importAt,
    `\n${emit(`import { useSignals as ${hookName} } from "${SIGNALS_IMPORT_SOURCE}";`)}\n`
  );
  return {
    code: output.toString(),
    map: output.generateMap({ source: id, includeContent: true, hires: true })
  };
}

export function signalsTracking(): Plugin {
  let sourceRoot = "";
  const trackedFiles = new Set<string>();
  return {
    name: "konogame:signals-tracking",
    enforce: "pre",
    configResolved(config) {
      sourceRoot = `${resolve(config.root, "src").replaceAll("\\", "/")}/`;
    },
    transform(code, id) {
      const [filename, query = ""] = id.replaceAll("\\", "/").split("?", 2);
      if (
        !filename?.startsWith(sourceRoot) ||
        !/\.[cm]?[jt]sx?$/.test(filename) ||
        /(?:^|\/)(?:node_modules|__tests__)(?:\/|$)|\.gen\.[^/]+$/.test(filename) ||
        /(?:^|&)(?:raw|url)(?:&|$)/.test(query)
      ) {
        return null;
      }
      const result = transformSignals(code, filename);
      if (result) {
        trackedFiles.add(filename);
      } else {
        trackedFiles.delete(filename);
      }
      return result;
    },
    hotUpdate({ file }) {
      if (
        this.environment.config.consumer !== "client" ||
        !trackedFiles.has(file.replaceAll("\\", "/"))
      ) {
        return;
      }
      // Oxc Refresh does not collect hook signatures inside try blocks. Reload the
      // previous tracked generation even when this edit removes its last read.
      this.environment.hot.send({ type: "full-reload" });
      return [];
    }
  };
}
