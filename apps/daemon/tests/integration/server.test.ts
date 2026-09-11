import { expect, it } from "@effect/vitest";
import { runDaemon, startDaemon } from "@konogame/daemon";
import {
  defineExtensionModule,
  EXTENSION_LIFECYCLE,
  provideFeaturePlan,
  provideInfrastructure
} from "@konogame/infrastructure";
import { type ImplementationPort } from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";

interface SyntheticPort {
  run(): Effect.Effect<void>;
}
const syntheticPort: ImplementationPort<SyntheticPort> = {
  id: "fixture.port",
  operations: { run: "run" },
  is: (value): value is SyntheticPort =>
    !!value && typeof value === "object" && "run" in value && typeof value.run === "function"
};
function syntheticPlans() {
  const infrastructure = provideInfrastructure({}, [
    {
      id: "fixture.source",
      discover: () =>
        Effect.succeed({
          complete: true,
          contributions: [
            {
              kind: "module" as const,
              manifest: {
                id: "fixture.module",
                contractRange: "^0.2.0",
                features: [
                  {
                    id: "fixture.run",
                    port: syntheticPort.id,
                    operation: "run",
                    portContractVersion: "0.2.0",
                    requiredCapabilities: []
                  }
                ],
                contributes: {
                  adapters: [
                    {
                      id: "fixture.adapter",
                      owner: { kind: "module" as const, id: "fixture.module" },
                      port: syntheticPort.id,
                      contractRange: "^0.2.0",
                      portContractRange: "^0.2.0",
                      operations: ["run"],
                      capabilities: []
                    }
                  ]
                }
              },
              load: () =>
                Effect.succeed(
                  defineExtensionModule({
                    activate: (context) =>
                      context.registerAdapter("fixture.adapter", syntheticPort, {
                        run: () => Effect.void
                      })
                  })
                )
            }
          ]
        })
    }
  ]);
  return provideFeaturePlan().pipe(
    Layer.provideMerge(infrastructure),
    Layer.tap((services) => Context.get(services, EXTENSION_LIFECYCLE).initialize())
  );
}

it.live("daemon exposes health and planning on an ephemeral local port", () =>
  Effect.gen(function* () {
    const server = yield* startDaemon({ port: 0, overrides: syntheticPlans() });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const base = `http://127.0.0.1:${address.port}`;
    const json = (path: string) =>
      Effect.promise(async () => (await fetch(`${base}${path}`)).json());
    expect(yield* json("/health")).toEqual({ status: "ok" });
    expect(yield* json("/plan?feature=fixture.run")).toMatchObject({
      bindings: [{ adapterId: "fixture.adapter" }]
    });
    expect((yield* Effect.promise(() => fetch(`${base}/plan?feature=unknown`))).status).toBe(400);
    expect((yield* Effect.promise(() => fetch(`${base}/missing`))).status).toBe(404);
  })
);

it.effect("daemon rejects invalid ports before creating a listener", () =>
  Effect.gen(function* () {
    for (const port of [-1, 65536, NaN, 1.5]) {
      const result = yield* Effect.result(startDaemon({ port }));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DaemonError", message: expect.stringContaining("port") }
      });
    }
  })
);

it.effect("runDaemon handles --version and --help in-process without starting a server", () =>
  Effect.gen(function* () {
    expect(yield* runDaemon({}, ["--version"])).toBe(0);
    expect(yield* runDaemon({}, ["--help"])).toBe(0);
  })
);
