import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Hono } from "hono";

const webRoot = fileURLToPath(
  new URL("./dist/client/", import.meta.resolve("@konogame/webui/package.json"))
);

export function registerWebUi(app: Hono<{ Bindings: HttpBindings }>) {
  const staticFile = serveStatic({ root: webRoot });
  app.get("*", async (context, next) => {
    const path = context.req.path;
    // API misses must remain machine-readable, including obsolete documentation routes.
    if (path === "/api" || path.startsWith("/api/")) {
      return next();
    }
    if (path.startsWith("/assets/")) {
      return staticFile(context, next);
    }
    if (!context.req.header("accept")?.includes("text/html")) {
      return next();
    }
    let shell: string;
    try {
      shell = await readFile(join(webRoot, "_shell.html"), "utf8");
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return next();
      }
      throw error;
    }
    // Start emits small inline bootstrap scripts; authorize only the built shell's exact bytes.
    const hashes = [
      ...shell.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)
    ].map((match) => `'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`);
    context.header(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; font-src 'self' data:`
    );
    return context.html(shell);
  });
}
