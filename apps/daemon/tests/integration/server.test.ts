import { startDaemon } from "@konogame/daemon";
import { expect, test } from "vitest";

test("daemon exposes health and planning on an ephemeral local port", async () => {
  const server = await startDaemon({ port: 0 });
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP listener");
    const base = `http://127.0.0.1:${address.port}`;
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: "ok" });
    expect(
      (
        (await (await fetch(`${base}/plan?feature=save.store`)).json()) as {
          bindings: { adapterId: string }[];
        }
      ).bindings[0]?.adapterId
    ).toBe("filesystem.save-store");
    expect((await fetch(`${base}/plan?feature=unknown`)).status).toBe(400);
    expect((await fetch(`${base}/missing`)).status).toBe(404);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});

test("daemon rejects invalid ports before creating a listener", async () => {
  for (const port of [-1, 65536, NaN, 1.5])
    await expect(startDaemon({ port })).rejects.toThrow(/port/);
});
