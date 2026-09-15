import { type HttpBindings } from "@hono/node-server";
import { Cause, type Context, Effect, type Exit, type Fiber } from "effect";
import { Hono, type Context as HonoContext } from "hono";
import { catalogRoutes, legacyRoutes } from "./catalog.ts";
import { gameRoutes } from "./game.ts";
import { createOpenApiDocument } from "./openapi.ts";
import { ApiError, ApiMethod, type ApiRoute, type ApiServices, ApiStatus } from "./route.ts";
import { saveRoutes } from "./save.ts";
import { registerWebUi } from "./webui.ts";
import { workspaceRoutes } from "./workspace.ts";

export const MAX_JSON_BODY_BYTES = 1024 * 1024;

export const daemonRoutes: readonly ApiRoute[] = [
  ...catalogRoutes,
  ...workspaceRoutes,
  ...gameRoutes,
  ...saveRoutes,
  ...legacyRoutes
];

type HttpContext = HonoContext<{ Bindings: HttpBindings }>;
type RunRequest = (effect: Effect.Effect<Response, unknown>) => Fiber.Fiber<Response, unknown>;

const failureStatuses: Readonly<Record<string, ApiStatus>> = {
  FeatureNotFoundError: ApiStatus.BadRequest,
  ExtensionNotFoundError: ApiStatus.NotFound,
  WorkspaceNotFoundError: ApiStatus.NotFound,
  GameDiscoveryNotFoundError: ApiStatus.NotFound,
  SchemaValidationError: ApiStatus.BadRequest,
  WorkspaceInvalidInputError: ApiStatus.BadRequest,
  WorkspaceSelectionError: ApiStatus.BadRequest,
  ConfigurationInvalidInputError: ApiStatus.BadRequest,
  GameDiscoveryInputError: ApiStatus.BadRequest,
  WorkspaceConflictError: ApiStatus.Conflict,
  GameDiscoveryConflictError: ApiStatus.Conflict,
  GameDiscoveryReviewMismatchError: ApiStatus.Conflict,
  WorkspaceWriterConflict: ApiStatus.Conflict,
  WorkspaceWriterRecoveryRequired: ApiStatus.Conflict,
  WorkspaceReviewMismatchError: ApiStatus.Conflict,
  AdapterResolutionUnavailableError: ApiStatus.Unprocessable,
  GameDiscoveryUnavailableError: ApiStatus.Unprocessable
};

function json(value: unknown, status: ApiStatus = ApiStatus.Ok) {
  return Response.json(value, { status });
}

function rejection(status: ApiStatus, message: string) {
  return json({ error: { tag: "ApiError", message } }, status);
}

function failureResponse(error: unknown) {
  if (error instanceof ApiError) {
    return json(
      { error: { tag: error._tag, message: error.message, issues: error.issues } },
      error.status
    );
  }
  if (error && typeof error === "object" && "_tag" in error && typeof error._tag === "string") {
    let status = failureStatuses[error._tag];
    const filesystemTags = [
      "WorkspaceFileSystemError",
      "DiscoveryFileSystemError",
      "ArtifactError",
      "SaveError"
    ];
    let nativeCode: string | undefined;
    if (filesystemTags.includes(error._tag)) {
      let current: unknown = error;
      const visited = new Set<object>();
      while (current && typeof current === "object" && !visited.has(current)) {
        visited.add(current);
        if ("code" in current && typeof current.code === "string") {
          nativeCode = current.code;
          break;
        }
        if (!("_tag" in current) || !filesystemTags.includes(String(current._tag))) {
          break;
        }
        current = "cause" in current ? current.cause : undefined;
      }
      switch (nativeCode) {
        case "ENOENT":
        case "ENOTDIR":
          status = ApiStatus.NotFound;
          break;
        case "EACCES":
        case "EPERM":
          status = ApiStatus.Forbidden;
          break;
        case "EEXIST":
        case "ENOTEMPTY":
        case "EBUSY":
          status = ApiStatus.Conflict;
          break;
      }
    }
    if (status) {
      return json(
        {
          error: {
            tag: error._tag,
            message: "message" in error ? String(error.message) : error._tag,
            ...(nativeCode ? { code: nativeCode } : {}),
            ...("issue" in error ? { issues: error.issue } : {}),
            ...("issues" in error ? { issues: error.issues } : {})
          }
        },
        status
      );
    }
  }
  return rejection(ApiStatus.InternalError, "Internal server error");
}

function resultResponse(route: ApiRoute, value: unknown) {
  if (value && typeof value === "object" && "status" in value) {
    const status =
      typeof value.status === "string" ? route.resultStatusCodes?.[value.status] : undefined;
    if (status) {
      return json(value, status);
    }
  }
  return json(value);
}

function verifyLocalRequest(context: HttpContext) {
  const remoteAddress = context.env.incoming.socket.remoteAddress?.toLowerCase();
  const peer = remoteAddress?.startsWith("::ffff:") ? remoteAddress.slice(7) : remoteAddress;
  if (peer !== "::1" && !peer?.startsWith("127.")) {
    return false;
  }
  const host = context.req.header("host");
  if (!host) {
    return false;
  }
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return false;
  }
  const local = context.env.incoming.socket;
  const names = new Set(["localhost", "127.0.0.1", "[::1]", local.localAddress]);
  if (local.localAddress?.includes(":")) {
    names.add(`[${local.localAddress}]`);
  }
  if (url.host !== host.toLowerCase() || url.username || url.password || !names.has(url.hostname)) {
    return false;
  }
  if (Number(url.port || 80) !== local.localPort) {
    return false;
  }
  const origin = context.req.header("origin");
  if (origin !== undefined && origin !== url.origin) {
    return false;
  }
  return context.req.header("sec-fetch-site") !== "cross-site";
}

async function readJson(request: Request): Promise<unknown> {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_JSON_BODY_BYTES)
  ) {
    throw new ApiError({
      status: ApiStatus.PayloadTooLarge,
      message: "JSON request body exceeds 1 MiB"
    });
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw ApiError.badRequest("A JSON request body is required");
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) {
        break;
      }
      size += item.value.byteLength;
      if (size > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError({
          status: ApiStatus.PayloadTooLarge,
          message: "JSON request body exceeds 1 MiB"
        });
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw ApiError.badRequest("Request body must contain valid UTF-8 JSON");
  }
}

class ApiServer {
  constructor(
    private readonly services: Context.Context<ApiServices>,
    private readonly runRequest: RunRequest
  ) {}

  app() {
    const app = new Hono<{ Bindings: HttpBindings }>();
    app.use("*", async (context, next) => {
      context.header("X-Content-Type-Options", "nosniff");
      context.header("Cache-Control", "no-store");
      context.header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
      );
      if (!verifyLocalRequest(context)) {
        return rejection(
          ApiStatus.Forbidden,
          "Request Host and Origin must match the local daemon"
        );
      }
      await next();
    });
    app.get("/api/openapi.json", () => json(createOpenApiDocument(daemonRoutes)));
    for (const route of daemonRoutes) {
      app.on(route.method, route.path.replace(/\{([^}]+)\}/g, ":$1"), (context) =>
        this.execute(route, context)
      );
    }
    registerWebUi(app);
    app.notFound(() => rejection(ApiStatus.NotFound, "Not found"));
    app.onError(() => rejection(ApiStatus.InternalError, "Internal server error"));
    return app;
  }

  private execute(route: ApiRoute, context: HttpContext): Promise<Response> {
    const request = Effect.gen({ self: this }, function* () {
      let body: unknown;
      if (route.method === ApiMethod.Post) {
        const contentType = context.req
          .header("content-type")
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (contentType !== "application/json") {
          return rejection(
            ApiStatus.UnsupportedMediaType,
            "Mutations require Content-Type: application/json"
          );
        }
        body = yield* Effect.tryPromise({
          try: () => readJson(context.req.raw),
          catch: (error) => error
        });
      }
      const value = yield* route
        .handler({
          body,
          query: new URL(context.req.url).searchParams,
          params: context.req.param()
        })
        .pipe(Effect.provide(this.services));
      return resultResponse(route, value);
    }).pipe(
      Effect.scoped,
      Effect.catchCause((cause) => {
        if (Cause.hasInterrupts(cause)) {
          return Effect.failCause(cause);
        }
        const failures = cause.reasons.filter(Cause.isFailReason);
        if (failures.length === cause.reasons.length && failures.length === 1) {
          return Effect.succeed(failureResponse(failures[0]!.error));
        }
        return Effect.logError(cause).pipe(
          Effect.as(rejection(ApiStatus.InternalError, "Internal server error"))
        );
      })
    );
    return new Promise((resolve) => {
      const fiber = this.runRequest(request);
      const onClose = () => {
        if (!context.env.outgoing.writableEnded) {
          fiber.interruptUnsafe();
        }
      };
      context.env.outgoing.once("close", onClose);
      fiber.addObserver((exit: Exit.Exit<Response, unknown>) => {
        context.env.outgoing.off("close", onClose);
        if (exit._tag === "Success") {
          resolve(exit.value);
        } else {
          context.env.outgoing.destroy();
          resolve(rejection(ApiStatus.InternalError, "Request interrupted"));
        }
      });
    });
  }
}

export function createApiApp(services: Context.Context<ApiServices>, runRequest: RunRequest) {
  return new ApiServer(services, runRequest).app();
}
