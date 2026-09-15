import { expect, test, vi } from "vitest";
import { runUiEffect } from "../../effect/run-ui-effect.ts";
import {
  ApiDecodeError,
  ApiNetworkError,
  ApiPathError,
  ApiRequestError,
  BrowserDaemonHttp
} from "../daemon-http.ts";

test("preserves structured daemon refusals and classifies transport and decoding failures", async () => {
  const body = {
    error: { tag: "WorkspaceConflict", message: "changed", issues: [{ path: "root" }] }
  };
  const http = new BrowserDaemonHttp(
    vi.fn(async () => new Response(JSON.stringify(body), { status: 409 }))
  );
  await expect(runUiEffect(http.request("/api/games"))).rejects.toMatchObject({
    _tag: "ApiRequestError",
    status: 409,
    tag: "WorkspaceConflict",
    issues: body.error.issues,
    body
  });
  expect(new ApiRequestError(409, body)).toBeInstanceOf(Error);
  const offline = new BrowserDaemonHttp(
    vi.fn(async () => {
      throw new TypeError("offline");
    })
  );
  await expect(runUiEffect(offline.request("/api/games"))).rejects.toBeInstanceOf(ApiNetworkError);
  const invalid = new BrowserDaemonHttp(vi.fn(async () => new Response("not json")));
  await expect(runUiEffect(invalid.request("/api/games"))).rejects.toBeInstanceOf(ApiDecodeError);
});

test("refuses paths escaping the same-origin API and forwards caller headers with local credentials", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{}"));
  const http = new BrowserDaemonHttp(fetch);
  for (const path of [
    "https://example.invalid/api/games",
    "//example.invalid/api/games",
    "/api/../secret",
    "/api/%2e%2e/secret",
    "/api/\\example.invalid"
  ]) {
    await expect(runUiEffect(http.request(path))).rejects.toBeInstanceOf(ApiPathError);
  }
  expect(fetch).not.toHaveBeenCalled();
  await runUiEffect(
    http.request("/api/games", { method: "POST", body: "{}", headers: { "X-Review": "yes" } })
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/games",
    expect.objectContaining({
      credentials: "same-origin",
      redirect: "error",
      mode: "same-origin"
    })
  );
  const headers = new Headers(fetch.mock.calls[0]![1]?.headers);
  expect(headers.get("X-Review")).toBe("yes");
  expect(headers.get("Content-Type")).toBe("application/json");
});

test("cancels an unfinished response body through the same Effect signal", async () => {
  let bodyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    bodyStarted = resolve;
  });
  let observedSignal: AbortSignal | undefined;
  const http = new BrowserDaemonHttp(
    vi.fn(async (_input, init) => {
      observedSignal = init?.signal ?? undefined;
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            bodyStarted();
            observedSignal!.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true
            });
          })
      } as Response;
    })
  );
  const controller = new AbortController();
  const request = runUiEffect(http.request("/api/games"), controller.signal);
  await started;
  controller.abort();
  await expect(request).rejects.toBeDefined();
  expect(observedSignal?.aborted).toBe(true);
});
