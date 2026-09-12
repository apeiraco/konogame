import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ADAPTER_RESOLUTION_PLANNER, ID_SERVICE, UuidIdService } from "@konogame/infrastructure";
import { CORE_VERSION } from "@konogame/infrastructure/contracts";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
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
    const plan =
      outcome === "error"
        ? Layer.succeed(ADAPTER_RESOLUTION_PLANNER, {
            plan: (featureIds: readonly string[]) =>
              Effect.fail(new Error(`Unknown feature: ${featureIds.join(", ")}`))
          } as never)
        : outcome === "cancel"
          ? Layer.succeed(WORKSPACE_MANAGEMENT, {
              inspectWorkspace: () => Effect.fail(new Error("Synthetic"))
            } as never)
          : Layer.empty;
    const code = await Effect.runPromise(
      runCli(args, {
        overrides: Layer.mergeAll(ids, prompts, plan),
        env: {},
        isTTY: outcome === "cancel" || outcome === "menu-cancel",
        stdout: (text) => {
          stdout += text;
        },
        stderr() {}
      })
    );
    if (outcome === "version") {
      expect(stdout).toContain(CORE_VERSION);
    }
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
    const overrides = Layer.merge(
      Layer.succeed(ADAPTER_RESOLUTION_PLANNER, {
        features: () => Effect.succeed([]),
        plan: (featureIds: readonly string[]) =>
          Effect.fail(new Error(`Unknown feature: ${featureIds.join(", ")}`))
      } as never),
      Layer.effect(
        ID_SERVICE,
        Effect.acquireRelease(Effect.succeed(new UuidIdService()), () =>
          Effect.die(new Error("cleanup detail"))
        )
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
    if (operationFails) {
      expect(errors).toContain("Unknown feature: unknown");
    }
  });
}

test("runCli keeps owner Context across commands and routes logger diagnostics to stderr", async () => {
  const results = [];
  for (const marker of ["first", "second"]) {
    let stdout = "";
    let stderr = "";
    const overrides = Layer.succeed(ADAPTER_RESOLUTION_PLANNER, {
      features: () => Effect.succeed([marker])
    } as never);
    const code = await Effect.runPromise(
      runCli(["features", "--json"], {
        overrides,
        env: {},
        isTTY: false,
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        }
      })
    );
    results.push({ code, data: JSON.parse(stdout), stderr });
  }
  expect(results).toEqual([
    { code: 0, data: ["first"], stderr: "" },
    { code: 0, data: ["second"], stderr: "" }
  ]);

  let stdout = "";
  const stderrChunks: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    stderrChunks.push(args.map(String).join(" "));
  };
  try {
    const overrides = Layer.merge(
      Layer.succeed(ADAPTER_RESOLUTION_PLANNER, {
        features: () => Effect.succeed(["save.store"])
      } as never),
      Layer.effect(
        ID_SERVICE,
        Effect.acquireRelease(Effect.succeed(new UuidIdService()), () =>
          Effect.logError("Synthetic recovery-required diagnostic")
        )
      )
    );
    const code = await Effect.runPromise(
      runCli(["features", "--json"], {
        overrides,
        env: {},
        isTTY: false,
        stdout: (text) => {
          stdout += text;
        }
      })
    );
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual(["save.store"]);
    expect(stderrChunks.join("\n")).toContain("Synthetic recovery-required diagnostic");
  } finally {
    console.error = originalError;
  }
});

test("runCli catalog commands load declarations without executing Extension implementations and reject relative roots", async () => {
  const directory = await createTestDirectory(
    import.meta.dirname,
    "unit",
    "cli",
    "lifecycle",
    "installed"
  );
  const roots = join(directory, "installed");
  const packageDirectory = join(roots, "fixture.external");
  const marker = join(directory, "executed");
  await mkdir(join(packageDirectory, "dist"), { recursive: true });
  await writeFile(
    join(packageDirectory, "konogame-extension.json"),
    JSON.stringify({
      schemaVersion: "extension.package.1",
      manifest: {
        id: "fixture.external",
        version: "1.0.0",
        declarationProtocolRange: ">=0.2.0 <0.3.0",
        software: {},
        activationEvents: ["onStartup"],
        contributes: {}
      },
      module: {
        entry: "./dist/extension.mjs",
        factory: "createExtensionModule",
        options: { marker }
      }
    })
  );
  await writeFile(
    join(packageDirectory, "dist/extension.mjs"),
    `import { writeFileSync } from "node:fs"; import { Effect } from "effect"; export function createExtensionModule(options) { return Effect.sync(() => { writeFileSync(options.marker, "executed"); return { activate: () => Effect.void }; }); }`
  );
  const env = {
    KONOGAME_EXTENSION_ROOTS: JSON.stringify([roots]),
    KONOGAME_SAVE_ROOT: join(directory, "saves")
  };

  for (const args of [
    ["extension", "list", "--json"],
    ["extension", "status", "fixture.external", "--json"],
    ["extension", "refresh", "--json"]
  ]) {
    let stdout = "";
    let stderr = "";
    const code = await Effect.runPromise(
      runCli(args, {
        env,
        isTTY: false,
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        }
      })
    );
    expect({ args, code, stderr }).toEqual({ args, code: 0, stderr: "" });
    const parsed = JSON.parse(stdout);
    if (args[1] === "list") {
      expect(parsed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "fixture.external", activation: "inactive" })
        ])
      );
    } else if (args[1] === "status") {
      expect(parsed).toMatchObject({
        extensions: [{ id: "fixture.external", activation: "inactive" }]
      });
    } else {
      expect(parsed).toMatchObject({
        added: [],
        replaced: [],
        removed: [],
        restartRequired: [],
        unchanged: expect.arrayContaining(["fixture.external"])
      });
    }
  }
  await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });

  let badStderr = "";
  const badCode = await Effect.runPromise(
    runCli(["extension", "list", "--json"], {
      env: { KONOGAME_EXTENSION_ROOTS: '["relative"]' },
      isTTY: false,
      stdout() {},
      stderr: (text) => {
        badStderr += text;
      }
    })
  );
  expect(badCode).toBe(1);
  expect(badStderr).toContain("absolute paths");

  let helpStdout = "";
  const helpCode = await Effect.runPromise(
    runCli(["--help"], {
      env: { KONOGAME_EXTENSION_ROOTS: '["relative"]' },
      isTTY: false,
      stdout: (text) => {
        helpStdout += text;
      },
      stderr() {}
    })
  );
  expect(helpCode).toBe(0);
  expect(helpStdout).toContain("extension");
});
