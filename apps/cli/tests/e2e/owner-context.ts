import { FEATURE_PLAN } from "@konogame/infrastructure";
import { Effect, Layer } from "effect";

export async function runOwnerContext(entry: string) {
  if (!entry) throw new Error("Missing CLI entry");
  const { runCli } = await import(entry);
  const results = [];
  for (const marker of ["first", "second"]) {
    let stdout = "";
    let stderr = "";
    const overrides = Layer.succeed(FEATURE_PLAN, {
      features: () => Effect.succeed([marker])
    } as never);
    const code = await Effect.runPromise(
      runCli(["features", "--json"], {
        overrides,
        env: {},
        isTTY: false,
        stdout: (text: string) => {
          stdout += text;
        },
        stderr: (text: string) => {
          stderr += text;
        }
      })
    );
    results.push({ code, data: JSON.parse(stdout), stderr });
  }
  return results;
}

if (import.meta.main)
  process.stdout.write(JSON.stringify(await runOwnerContext(process.argv[2] ?? "")));
