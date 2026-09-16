import { Context, Data, Effect, Layer } from "effect";

export function rootQuery(root: string, preferredAdapterId?: string) {
  return new URLSearchParams({
    root,
    ...(preferredAdapterId ? { preferredAdapterId } : {})
  }).toString();
}

export class ApiRequestError extends Data.TaggedError("ApiRequestError")<{
  readonly status: number;
  readonly body: unknown;
  readonly tag?: string;
  readonly issues?: unknown;
  readonly message: string;
}> {
  constructor(status: number, body: unknown) {
    const error = body && typeof body === "object" && "error" in body ? body.error : undefined;
    const detail = error && typeof error === "object" ? error : undefined;
    super({
      status,
      body,
      message: detail && "message" in detail ? String(detail.message) : `HTTP ${status}`,
      tag: detail && "tag" in detail ? String(detail.tag) : undefined,
      issues: detail && "issues" in detail ? detail.issues : undefined
    });
  }
}

export class ApiNetworkError extends Data.TaggedError("ApiNetworkError")<{
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message() {
    return "Cannot connect to the local daemon";
  }
}

export class ApiDecodeError extends Data.TaggedError("ApiDecodeError")<{
  readonly path: string;
  readonly status: number;
  readonly cause: unknown;
}> {
  override get message() {
    return "The daemon returned invalid JSON";
  }
}

export class ApiPathError extends Data.TaggedError("ApiPathError")<{
  readonly path: string;
}> {
  override get message() {
    return "API requests require a same-origin /api/ path";
  }
}

export type ApiError = ApiRequestError | ApiNetworkError | ApiDecodeError | ApiPathError;
export interface DaemonHttpService {
  readonly request: <T>(path: string, init?: RequestInit) => Effect.Effect<T, ApiError>;
}
export class DAEMON_HTTP extends Context.Service<DAEMON_HTTP, DaemonHttpService>()(
  "webui/DaemonHttp"
) {}

export class BrowserDaemonHttp implements DaemonHttpService {
  constructor(private readonly fetch: typeof globalThis.fetch) {}

  request<T>(path: string, init: RequestInit = {}): Effect.Effect<T, ApiError> {
    const fetch = this.fetch;
    const base = "http://daemon.invalid";
    if (
      !path.startsWith("/api/") ||
      path.includes("\\") ||
      /[\r\n]/u.test(path) ||
      !new URL(path, base).pathname.startsWith("/api/")
    ) {
      return Effect.fail(new ApiPathError({ path }));
    }
    return Effect.tryPromise({
      // Keep the signal connected through body consumption, not just response headers.
      try: async (signal) => {
        const headers = new Headers(init.headers);
        headers.set("Accept", "application/json");
        if (init.body !== undefined && init.body !== null) {
          headers.set("Content-Type", "application/json");
        }
        let response: Response;
        try {
          response = await fetch(path, {
            ...init,
            headers,
            signal,
            credentials: "same-origin",
            mode: "same-origin",
            redirect: "error"
          });
        } catch (cause) {
          throw new ApiNetworkError({ path, cause });
        }
        let body: unknown;
        try {
          body = await response.json();
        } catch (cause) {
          throw new ApiDecodeError({ path, status: response.status, cause });
        }
        if (!response.ok) {
          throw new ApiRequestError(response.status, body);
        }
        return body as T;
      },
      catch: (error): ApiError =>
        error instanceof ApiRequestError ||
        error instanceof ApiDecodeError ||
        error instanceof ApiNetworkError
          ? error
          : new ApiNetworkError({ path, cause: error })
    });
  }
}

export function provideDaemonHttp(fetch: typeof globalThis.fetch) {
  return Layer.succeed(DAEMON_HTTP, new BrowserDaemonHttp(fetch));
}
