import { resolve } from "node:path";
import { executeTestProcess, type TestProcessResult, testProcessEnvironment } from "./process.ts";

const main = resolve(import.meta.dirname, "../../apps/cli/dist/main.js");

export function runBuiltCli(args: readonly string[], cwd: string): Promise<TestProcessResult> {
  return executeTestProcess(process.execPath, [main, ...args], {
    cwd,
    env: testProcessEnvironment({ INTERACTIVE: "false", KONOGAME_EXTENSION_ROOTS: "[]" }),
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
    reject: false
  });
}
