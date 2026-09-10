import { runCli } from "@konogame/cli";
import { ID_SERVICE, UuidIdService } from "@konogame/infrastructure";
import { Effect, Layer } from "effect";

export async function runDefaultStreams(): Promise<void> {
  const overrides = Layer.effect(
    ID_SERVICE,
    Effect.acquireRelease(Effect.succeed(new UuidIdService()), () =>
      Effect.logError("Synthetic recovery-required diagnostic")
    )
  );
  const code = await Effect.runPromise(
    runCli(["features", "--json"], { overrides, env: {}, isTTY: false })
  );
  if (code) process.exitCode = code;
}

if (import.meta.main) await runDefaultStreams();
