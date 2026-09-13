import { isAbsolute } from "node:path";
import {
  configurationValueSchema,
  extensionManifestSchema
} from "@konogame/infrastructure/contracts";
import { type } from "arktype";

export const ExtensionPackageSchemaVersion = "extension.package.1";
export const EXTENSION_PACKAGE_FILENAME = "konogame-extension.json";
export const EXTENSION_PACKAGE_BYTE_LIMIT = 1024 * 1024;
export const EXTENSION_PACKAGE_COUNT_LIMIT = 256;

const entrySchema = type.string.narrow(
  (value, ctx) =>
    (value.startsWith("./") &&
      !/[\\\0:]/.test(value) &&
      value
        .slice(2)
        .split("/")
        .every((part) => part !== "" && part !== "." && part !== "..")) ||
    ctx.mustBe("a ./ relative entry without traversal, backslashes, or URL components")
);
const factorySchema = type.string.matching(
  /^[$_\p{ID_Start}](?:[$\p{ID_Continue}]|\u200c|\u200d)*$/u
);
export const extensionPackageSchema = type({
  "+": "reject",
  schemaVersion: `'${ExtensionPackageSchemaVersion}'`,
  manifest: extensionManifestSchema,
  module: {
    "+": "reject",
    entry: entrySchema,
    factory: factorySchema,
    "options?": configurationValueSchema
  }
});
export type ExtensionPackage = typeof extensionPackageSchema.infer;

export function parseExtensionPackage(text: string): ExtensionPackage {
  const value: unknown = JSON.parse(text);
  configurationValueSchema.assert(value);
  return extensionPackageSchema.assert(value);
}

export const extensionRootSchema = type.string.narrow(
  (value, ctx) =>
    (isAbsolute(value) &&
      !value.includes("\0") &&
      (process.platform !== "win32" || /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value))) ||
    ctx.mustBe("explicit absolute paths")
);
export const extensionRootsSchema = extensionRootSchema
  .array()
  .narrow(
    (values, ctx) => new Set(values).size === values.length || ctx.mustBe("unique absolute paths")
  );

export function validateExtensionRoots(roots: readonly string[]): readonly string[] {
  return Object.freeze([...extensionRootsSchema.assert(roots)]);
}

export function parseExtensionRoots(value: string | undefined): readonly string[] {
  if (value === undefined) {
    return [];
  }
  return validateExtensionRoots(extensionRootsSchema.assert(JSON.parse(value)));
}
