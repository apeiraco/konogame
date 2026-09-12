import { resolve } from "node:path";
import { spawn } from "node-pty";
import { expect } from "vitest";
import { testProcessEnvironment } from "./process.ts";

const main = resolve(import.meta.dirname, "../../apps/cli/dist/main.js");

export async function runTerminalCli(
  args: string[],
  cwd: string,
  steps: readonly { prompt: string | RegExp; input: string }[]
) {
  const terminal = spawn(process.execPath, [main, ...args], {
    name: "xterm-256color",
    cols: 180,
    rows: 40,
    cwd,
    env: testProcessEnvironment({
      TERM: "xterm-256color",
      INTERACTIVE: "true",
      KONOGAME_EXTENSION_ROOTS: "[]"
    })
  });
  let output = "";
  let exited = false;
  let exitCode: number | undefined;
  const data = terminal.onData((text) => {
    output += text;
  });
  const exit = terminal.onExit((event) => {
    exited = true;
    exitCode = event.exitCode;
  });
  try {
    for (const step of steps) {
      await expect.poll(() => output, { timeout: 15_000 }).toMatch(step.prompt);
      terminal.write(step.input);
    }
    await expect.poll(() => exited, { timeout: 15_000 }).toBe(true);
    return { output, exitCode };
  } finally {
    try {
      if (!exited) {
        terminal.kill();
        await expect.poll(() => exited, { timeout: 5_000 }).toBe(true);
      }
    } finally {
      data.dispose();
      exit.dispose();
    }
  }
}
