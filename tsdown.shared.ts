import { defineConfig, type UserConfig } from "tsdown";

export function packageBuild(
  entry: string | string[] = "src/index.ts",
  declarations = true,
  tsconfig = "tsconfig.lib.json"
): UserConfig {
  return defineConfig({
    entry,
    tsconfig,
    format: "esm",
    target: "node26",
    platform: "node",
    unbundle: true,
    deps: { neverBundle: true },
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
    dts: declarations,
    clean: true,
    sourcemap: true
  });
}
