import { type IncomingMessage } from "node:http";
import { type Plugin, type ProxyOptions } from "vite";

export function isLocalDevelopmentRequest(request: IncomingMessage): boolean {
  const peerAddress = request.socket.remoteAddress?.toLowerCase();
  const peer = peerAddress?.startsWith("::ffff:") ? peerAddress.slice(7) : peerAddress;
  if (peer !== "::1" && !peer?.startsWith("127.")) {
    return false;
  }
  const host = request.headers.host;
  if (!host) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (
    url.host !== host.toLowerCase() ||
    url.username ||
    url.password ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    Number(url.port || 80) !== request.socket.localPort
  ) {
    return false;
  }
  const origin = request.headers.origin;
  return (
    (origin === undefined || origin === url.origin) &&
    request.headers["sec-fetch-site"] !== "cross-site"
  );
}

export function localDevelopmentGuard(): Plugin {
  return {
    name: "konogame-local-development-guard",
    configureServer(server) {
      // Validate the browser-facing request before the proxy rewrites its authority.
      server.middlewares.use((request, response, next) => {
        if (!isLocalDevelopmentRequest(request)) {
          response.statusCode = 403;
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              error: {
                tag: "ApiError",
                message: "Request Host and Origin must match the local development server"
              }
            })
          );
          return;
        }
        next();
      });
    }
  };
}

export function daemonProxy(port: number): ProxyOptions {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("KONOGAME_DAEMON_PORT must be an integer from 1 to 65535");
  }
  const target = `http://127.0.0.1:${port}`;
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on("proxyReq", (outgoing, incoming) => {
        // The guard has already checked the original Origin against the Vite socket.
        if (incoming.headers.origin !== undefined) {
          outgoing.setHeader("Origin", target);
        }
      });
    }
  };
}
