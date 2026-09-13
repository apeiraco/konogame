import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DECLARATION_PROTOCOL_RANGE } from "@konogame/infrastructure/contracts";
import { EXTENSION_PACKAGE_FILENAME, type ExtensionPackage } from "../../src/index.ts";

export function packageDeclaration(id: string): ExtensionPackage {
  return {
    schemaVersion: "extension.package.1",
    manifest: {
      id,
      version: "1.0.0",
      declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
      software: {},
      contributes: {}
    },
    module: {
      entry: "./dist/extension.mjs",
      factory: "createExtensionModule"
    }
  };
}
export async function install(
  root: string,
  name: string,
  declaration: ExtensionPackage = packageDeclaration(name),
  code = 'import { Effect } from "effect"; export function createExtensionModule() { return { activate: () => Effect.void }; }'
) {
  const directory = join(root, name);
  await mkdir(join(directory, "dist"), { recursive: true });
  await writeFile(join(directory, EXTENSION_PACKAGE_FILENAME), JSON.stringify(declaration));
  await writeFile(join(directory, "dist", "extension.mjs"), code);
  return directory;
}
