import { createServer, request } from "node:http";
import { type AddressInfo } from "node:net";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";
import { daemonProxy, localDevelopmentGuard } from "../../tools/local-proxy.ts";

const backendRequests: { host: string | undefined; origin: string | undefined }[] = [];
const backend = createServer((incoming, outgoing) => {
  backendRequests.push({ host: incoming.headers.host, origin: incoming.headers.origin });
  outgoing.setHeader("Content-Type", "application/json");
  outgoing.end(JSON.stringify({ ok: true }));
});
let vite: ViteDevServer;
let port: number;
let backendPort: number;

beforeAll(async () => {
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  backendPort = (backend.address() as AddressInfo).port;
  vite = await createViteServer({
    configFile: false,
    logLevel: "silent",
    appType: "custom",
    plugins: [localDevelopmentGuard()],
    server: { host: "127.0.0.1", port: 0, hmr: false, proxy: { "/api": daemonProxy(backendPort) } }
  });
  await vite.listen();
  port = (vite.httpServer!.address() as AddressInfo).port;
});

afterAll(async () => {
  await vite?.close();
  await new Promise<void>((resolve, reject) =>
    backend.close((error) => (error ? reject(error) : resolve()))
  );
});

function send(headers: Record<string, string>, method = "GET") {
  return new Promise<number>((resolve, reject) => {
    const outgoing = request(
      { host: "127.0.0.1", port, path: "/api/health", method, headers },
      (incoming) => {
        incoming.resume();
        incoming.once("end", () => resolve(incoming.statusCode!));
      }
    );
    outgoing.once("error", reject);
    outgoing.end();
  });
}

test("forwards local requests after validating the original authority", async () => {
  expect(await send({ Origin: `http://127.0.0.1:${port}` })).toBe(200);
  expect(backendRequests.at(-1)).toEqual({
    host: `127.0.0.1:${backendPort}`,
    origin: `http://127.0.0.1:${backendPort}`
  });
  expect(await send({})).toBe(200);
  expect(backendRequests.at(-1)?.origin).toBeUndefined();
});

test("rejects rebinding and cross-origin requests before any proxy rewrite", async () => {
  const count = backendRequests.length;
  const attempts: Record<string, string>[] = [
    { Host: `attacker.example:${port}` },
    { Host: "127.0.0.1:1" },
    { Origin: "https://attacker.example" },
    { "Sec-Fetch-Site": "cross-site" },
    { Host: `attacker.example:${port}`, "Content-Type": "text/plain" },
    { Origin: "null", "Content-Type": "application/x-www-form-urlencoded" }
  ];
  for (const headers of attempts) {
    expect(await send(headers, "POST")).toBe(403);
  }
  expect(backendRequests).toHaveLength(count);
});
