import { request } from "node:http";
import { expect, it } from "@effect/vitest";
import { runDaemon, startDaemon } from "@konogame/daemon";
import {
  NodeWorkspaceFileSystem,
  WORKSPACE_NODE_FILESYSTEM,
  WorkspaceFileSystemError
} from "@konogame/extension-workspace-toml";
import {
  defineExtensionModule,
  EXTENSION_LIFECYCLE,
  provideAdapterResolutionPlanner,
  provideInfrastructure
} from "@konogame/infrastructure";
import { type ImplementationPort } from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";

function localAddress(server: Awaited<ReturnType<typeof import("node:http").createServer>>) {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP listener");
  }
  return `http://127.0.0.1:${address.port}`;
}

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
                declarationProtocolRange: "^0.2.0",
                features: [
                  {
                    id: "fixture.run",
                    port: syntheticPort.id,
                    operation: "run",
                    portVersion: "0.2.0",
                    requiredCapabilities: []
                  }
                ],
                contributes: {
                  adapters: [
                    {
                      id: "fixture.adapter",
                      owner: { kind: "module" as const, id: "fixture.module" },
                      port: syntheticPort.id,
                      declarationProtocolRange: "^0.2.0",
                      portVersionRange: "^0.2.0",
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
  return provideAdapterResolutionPlanner().pipe(
    Layer.provideMerge(infrastructure),
    Layer.tap((services) => Context.get(services, EXTENSION_LIFECYCLE).initialize())
  );
}

it.live("daemon exposes health and planning on an ephemeral local port", () =>
  Effect.gen(function* () {
    const server = yield* startDaemon({ port: 0, overrides: syntheticPlans() });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP listener");
    }
    const base = `http://127.0.0.1:${address.port}`;
    const json = (path: string) =>
      Effect.promise(async () => (await fetch(`${base}${path}`)).json());
    expect(yield* json("/health")).toEqual({ status: "ok" });
    expect(yield* json("/plan?feature=fixture.run")).toMatchObject({
      resolvedAdapters: [{ adapterId: "fixture.adapter" }]
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

it.effect("daemon refuses non-loopback listeners", () =>
  Effect.gen(function* () {
    for (const host of ["0.0.0.0", "::", "192.0.2.10", "example.invalid"]) {
      expect(yield* Effect.result(startDaemon({ host, port: 0 }))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "DaemonError", message: expect.stringContaining("loopback") }
      });
    }
  })
);

it.live("daemon exposes an offline interactive OpenAPI document and catalog routes", () =>
  Effect.gen(function* () {
    const base = localAddress(yield* startDaemon({ port: 0 }));
    const document = yield* Effect.promise(async () =>
      (await fetch(`${base}/api/openapi.json`)).json()
    );
    expect(document).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/api/features": { get: { operationId: "listFeatures" } },
        "/api/extensions/{id}": {
          get: { parameters: [{ name: "id", in: "path", required: true }] }
        },
        "/api/plan": { post: { requestBody: { required: true } } }
      }
    });
    const docs = yield* Effect.promise(async () => (await fetch(`${base}/api/openapi`)).text());
    expect(docs).toContain('src="/api/openapi/assets/swagger-ui-bundle.js"');
    expect(docs).not.toMatch(/(?:src|href)="https?:/);
    const initialization = yield* Effect.promise(async () =>
      (await fetch(`${base}/api/openapi/assets/initialize.js`)).text()
    );
    expect(initialization).toContain('url: "/api/openapi.json"');
    expect(initialization).toContain("validatorUrl: null");
    expect(initialization).toContain("queryConfigEnabled: false");
    for (const asset of ["swagger-ui.css", "swagger-ui-bundle.js"]) {
      const response = yield* Effect.promise(() => fetch(`${base}/api/openapi/assets/${asset}`));
      expect(response.status).toBe(200);
      expect((yield* Effect.promise(() => response.text())).length).toBeGreaterThan(1000);
    }
    expect(
      (yield* Effect.promise(() => fetch(`${base}/api/openapi/assets/package.json`))).status
    ).toBe(404);
    const features = yield* Effect.promise(async () =>
      (await fetch(`${base}/api/features`)).json()
    );
    expect(features).toContain("workspace.inspect");
    const catalog = yield* Effect.promise(async () =>
      (await fetch(`${base}/api/extension-catalog`)).json()
    );
    expect(catalog).toMatchObject({ extensions: expect.any(Array), adapters: expect.any(Array) });
    const response = yield* Effect.promise(() =>
      fetch(`${base}/api/plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: ["workspace.inspect"] })
      })
    );
    expect(response.status).toBe(200);
    expect(yield* Effect.promise(() => response.json())).toMatchObject({
      resolvedAdapters: [{ adapterId: "workspace-toml.configuration" }]
    });
    expect((yield* Effect.promise(() => fetch(`${base}/api/extensions/unknown`))).status).toBe(404);
    expect(
      (yield* Effect.promise(() =>
        fetch(`${base}/api/extensions/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceId: "unknown" })
        })
      )).status
    ).toBe(404);
  })
);

it.live("daemon rejects cross-origin requests and untrusted Host headers before dispatch", () =>
  Effect.gen(function* () {
    const base = localAddress(yield* startDaemon({ port: 0 }));
    for (const headers of [
      { origin: "https://example.invalid" },
      { origin: "null" },
      { host: "attacker.invalid" },
      { host: "127.0.0.1:1" },
      { "sec-fetch-site": "cross-site" }
    ]) {
      const response = yield* Effect.callback<
        { status?: number; allowOrigin?: string | string[] },
        Error
      >((resume) => {
        const outgoing = request(`${base}/api/health`, { headers }, (incoming) => {
          incoming.resume();
          resume(
            Effect.succeed({
              status: incoming.statusCode,
              allowOrigin: incoming.headers["access-control-allow-origin"]
            })
          );
        });
        outgoing.on("error", (error) => resume(Effect.fail(error)));
        outgoing.end();
        return Effect.sync(() => outgoing.destroy());
      });
      expect(response.status, JSON.stringify(headers)).toBe(403);
      expect(response.allowOrigin).toBeUndefined();
    }
    expect(
      (yield* Effect.promise(() => fetch(`${base}/api/health`, { headers: { origin: base } })))
        .status
    ).toBe(200);
  })
);

it.live(
  "daemon requires JSON and bounds declared and chunked bodies before mutation dispatch",
  () =>
    Effect.gen(function* () {
      const base = localAddress(yield* startDaemon({ port: 0 }));
      for (const contentType of [
        "text/plain",
        "application/x-www-form-urlencoded",
        "text/plain; application/json"
      ]) {
        const response = yield* Effect.promise(() =>
          fetch(`${base}/api/plan`, {
            method: "POST",
            headers: { "content-type": contentType },
            body: "{}"
          })
        );
        expect(response.status).toBe(415);
      }
      const malformed = yield* Effect.promise(() =>
        fetch(`${base}/api/plan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{"
        })
      );
      expect(malformed.status).toBe(400);
      for (const chunked of [false, true]) {
        const status = yield* Effect.callback<number, Error>((resume) => {
          const body = `"${"x".repeat(1024 * 1024)}"`;
          const outgoing = request(
            `${base}/api/plan`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...(chunked ? {} : { "content-length": Buffer.byteLength(body) })
              }
            },
            (response) => {
              response.resume();
              resume(Effect.succeed(response.statusCode ?? 0));
            }
          );
          outgoing.on("error", (error) => resume(Effect.fail(error)));
          if (chunked) {
            outgoing.write(body.slice(0, 512));
          }
          outgoing.end(chunked ? body.slice(512) : body);
          return Effect.sync(() => outgoing.destroy());
        });
        expect(status).toBe(413);
      }
    })
);

it.live("daemon classifies native filesystem failures by owner tag and code", () =>
  Effect.gen(function* () {
    for (const [code, expected] of [
      ["ENOENT", 404],
      ["EACCES", 403],
      ["EEXIST", 409],
      ["EIO", 500]
    ] as const) {
      const fileSystem = new NodeWorkspaceFileSystem();
      fileSystem.realPath = () =>
        Effect.fail(
          new WorkspaceFileSystemError({
            operation: "realpath",
            code,
            message: "Synthetic filesystem failure"
          })
        );
      const base = localAddress(
        yield* startDaemon({
          port: 0,
          overrides: Layer.succeed(WORKSPACE_NODE_FILESYSTEM, fileSystem)
        })
      );
      const response = yield* Effect.promise(() =>
        fetch(`${base}/api/workspace/inspect?${new URLSearchParams({ root: process.cwd() })}`)
      );
      expect(response.status, code).toBe(expected);
      const body = yield* Effect.promise(() => response.json());
      expect(body).toMatchObject({
        error: {
          message: expected === 500 ? "Internal server error" : "Synthetic filesystem failure"
        }
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
