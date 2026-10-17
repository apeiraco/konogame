import { createServer, type Server } from "node:http";
import { CORE_VERSION } from "@konogame/contracts";
import { createLocalApplication } from "@konogame/local-runtime";
import { Flags, Parser } from "@oclif/core";

export interface DaemonOptions {
  saveRoot?: string;
  application?: ReturnType<typeof createLocalApplication>;
}

export function createDaemon(options: DaemonOptions = {}): Server {
  const app = options.application ?? createLocalApplication(options.saveRoot);
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/plan") {
      try {
        response.end(JSON.stringify(app.plan([url.searchParams.get("feature") ?? "save.store"])));
      } catch (error) {
        response.statusCode = 400;
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
        );
      }
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  });
}

export async function startDaemon(
  options: DaemonOptions & { port?: number; host?: string } = {}
): Promise<Server> {
  const port = options.port ?? 38417;
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("Daemon port must be an integer from 0 to 65535");
  const server = createDaemon(options);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, options.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}

export async function runDaemon(
  env: NodeJS.ProcessEnv = process.env,
  argv: string[] = []
): Promise<Server | undefined> {
  const { flags } = await Parser.parse(argv, {
    flags: {
      version: Flags.boolean({ char: "v" }),
      help: Flags.boolean({ char: "h" })
    }
  });
  if (flags.version) {
    console.log(CORE_VERSION);
    return;
  }
  if (flags.help) {
    console.log(
      "Usage: konogame-daemon [--version] [--help]\nConfigure KONOGAME_DAEMON_PORT and KONOGAME_SAVE_ROOT through the environment."
    );
    return;
  }
  const server = await startDaemon({
    saveRoot: env.KONOGAME_SAVE_ROOT,
    port: Number(env.KONOGAME_DAEMON_PORT ?? "38417")
  });
  const address = server.address();
  if (address && typeof address !== "string")
    console.log(`Konogame prototype daemon listening on ${address.address}:${address.port}`);
  return server;
}

if (import.meta.main) {
  runDaemon(process.env, process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
