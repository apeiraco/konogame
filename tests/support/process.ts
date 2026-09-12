import { execa, type Options } from "execa";

export function testProcessEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/^(?:KONOGAME_|VITEST|VITE_|NODE_OPTIONS$|NODE_V8_COVERAGE$)/i.test(key)
      )
    ),
    ...overrides
  };
}

export interface TestProcessResult {
  stdout: string;
  stderr: string;
  exitCode?: number | undefined;
}

export async function executeTestProcess(
  file: string,
  args: readonly string[],
  options: Pick<Options, "cwd" | "env" | "timeout" | "maxBuffer" | "reject"> = {}
): Promise<TestProcessResult> {
  return execa(file, args, {
    timeout: 8_000,
    ...options,
    env: testProcessEnvironment(options.env),
    extendEnv: false
  });
}
