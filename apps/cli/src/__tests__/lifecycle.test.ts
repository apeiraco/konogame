import { CORE_VERSION } from "@konogame/contracts";
import { ID_SERVICE, UuidIdService } from "@konogame/infrastructure";
import { Effect, Layer } from "effect";
import { expect, test } from "vitest";
import { createTestDirectory } from "../../../../tests/support/temp.ts";
import { Cancelled, CLI_PROMPTS, runCli } from "../main.ts";

const cwd = await createTestDirectory(import.meta.dirname, "unit", "cli", "lifecycle", "cwd");

for (const outcome of [
  "success",
  "error",
  "cancel",
  "menu-cancel",
  "schema",
  "help",
  "version"
] as const) {
  test(`runCli scopes owner services after ${outcome}`, async () => {
    const args =
      outcome === "success"
        ? ["features", "--json"]
        : outcome === "error"
          ? ["plan", "unknown"]
          : outcome === "cancel"
            ? ["workspace", "rename", cwd]
            : outcome === "schema"
              ? ["workspace", "schema", "--json"]
              : outcome === "help"
                ? ["--help"]
                : outcome === "version"
                  ? ["--version"]
                  : [];
    let cleanups = 0;
    let acquisitions = 0;
    let stdout = "";
    const ids = Layer.effect(
      ID_SERVICE,
      Effect.acquireRelease(
        Effect.sync(() => {
          acquisitions++;
          return new UuidIdService();
        }),
        () =>
          Effect.sync(() => {
            cleanups++;
          })
      )
    );
    const prompts = Layer.succeed(CLI_PROMPTS, {
      text: () => Effect.fail(new Cancelled()),
      select: () => Effect.fail(new Cancelled()),
      confirm: () => Effect.fail(new Cancelled())
    });
    const code = await Effect.runPromise(
      runCli(args, {
        overrides: Layer.merge(ids, prompts),
        env: {},
        isTTY: outcome === "cancel" || outcome === "menu-cancel",
        stdout: (text) => {
          stdout += text;
        },
        stderr() {}
      })
    );
    if (outcome === "version") expect(stdout).toContain(CORE_VERSION);
    expect({
      code,
      cleanups,
      acquisitions
    }).toEqual({
      code: outcome === "error" ? 1 : outcome === "cancel" || outcome === "menu-cancel" ? 130 : 0,
      cleanups: 1,
      acquisitions: 1
    });
  });
}

for (const operationFails of [false, true]) {
  test(`runCli reports workflow and finalizer failures after operation failure=${operationFails}`, async () => {
    let errors = "";
    const overrides = Layer.effect(
      ID_SERVICE,
      Effect.acquireRelease(Effect.succeed(new UuidIdService()), () =>
        Effect.die(new Error("cleanup detail"))
      )
    );
    const code = await Effect.runPromise(
      runCli(operationFails ? ["plan", "unknown", "--json"] : ["features", "--json"], {
        overrides,
        env: {},
        isTTY: false,
        stdout() {},
        stderr(text) {
          errors += text;
        }
      })
    );
    expect(code).toBe(1);
    expect(errors).toContain("cleanup detail");
    if (operationFails) expect(errors).toContain("Unknown feature: unknown");
  });
}
