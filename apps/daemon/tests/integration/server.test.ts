import { expect, it } from "@effect/vitest";
import { startDaemon } from "@konogame/daemon";
import { Effect } from "effect";

it.live("daemon exposes health and planning on an ephemeral local port", () =>
  Effect.gen(function* () {
    const server = yield* startDaemon({ port: 0 });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const base = `http://127.0.0.1:${address.port}`;
    const json = (path: string) =>
      Effect.promise(async () => (await fetch(`${base}${path}`)).json());
    expect(yield* json("/health")).toEqual({ status: "ok" });
    expect(yield* json("/plan?feature=save.store")).toMatchObject({
      bindings: [{ adapterId: "filesystem.save-store" }]
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
