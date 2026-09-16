import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { describe, expect } from "vitest";
import { ApiRequestError, type DaemonHttpService } from "../../infrastructure/http/daemon-http.ts";
import { WorkspaceOpenService } from "../workspace-open.service.ts";
import { WorkspaceQueryService } from "../workspace-query.service.ts";
import { WorkspaceSession } from "../workspace-session.service.ts";

const brokenRoot = "/synthetic/broken";

function setup(respond: (path: string) => Effect.Effect<unknown, ApiRequestError>) {
  const requests: string[] = [];
  const http: DaemonHttpService = {
    request: <T>(path: string) => {
      requests.push(path);
      return respond(path) as Effect.Effect<T, ApiRequestError>;
    }
  };
  const session = new WorkspaceSession(() => undefined);
  const opener = new WorkspaceOpenService(session, new WorkspaceQueryService(http));
  return { session, opener, requests };
}

const inspectFailure = new ApiRequestError(422, {
  error: { tag: "ConfigurationInvalidInputError", message: "Invalid TOML" }
});

describe("Workspace opening", () => {
  it.effect("switches only after the formal read and keeps the current Workspace on failure", () =>
    Effect.gen(function* () {
      const { session, opener, requests } = setup((path) =>
        path.includes(encodeURIComponent(brokenRoot))
          ? Effect.fail(inspectFailure)
          : Effect.succeed({})
      );
      expect(yield* opener.open("/synthetic/good")).toBe(true);
      expect(session.workspaceRoot.peek()).toBe("/synthetic/good");
      const epoch = session.epoch.peek();

      expect(yield* opener.open(brokenRoot)).toBe(false);
      expect(session.workspaceRoot.peek()).toBe("/synthetic/good");
      expect(session.epoch.peek()).toBe(epoch);
      expect(opener.failure.peek()).toMatchObject({ root: brokenRoot, error: inspectFailure });
      expect(opener.pending.peek()).toBeUndefined();
      expect(requests.every((path) => path.startsWith("/api/workspace/inspect?"))).toBe(true);
      opener.clearFailure();
      expect(opener.failure.peek()).toBeUndefined();
    })
  );

  it.effect("lets a newer open win over a slower older one", () =>
    Effect.gen(function* () {
      const slow = yield* Deferred.make<unknown, ApiRequestError>();
      const { session, opener } = setup((path) =>
        path.includes(encodeURIComponent("/synthetic/slow"))
          ? Deferred.await(slow)
          : Effect.succeed({})
      );
      const older = yield* opener.open("/synthetic/slow").pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      expect(opener.pending.peek()).toBe("/synthetic/slow");
      expect(yield* opener.open("/synthetic/fast")).toBe(true);
      yield* Deferred.succeed(slow, {});
      expect(yield* Fiber.join(older)).toBe(false);
      expect(session.workspaceRoot.peek()).toBe("/synthetic/fast");
      expect(opener.pending.peek()).toBeUndefined();
    })
  );

  it.effect("pins the probed configuration Adapter for the formal read and selected session", () =>
    Effect.gen(function* () {
      const adapterId = "synthetic.configuration";
      const { session, opener, requests } = setup(() =>
        Effect.succeed({
          adapterResolutionPlan: { resolvedAdapters: [{ adapterId }] }
        })
      );
      expect(yield* opener.open("/synthetic/probed", adapterId)).toBe(true);
      expect(new URL(requests[0]!, "http://localhost").searchParams.get("preferredAdapterId")).toBe(
        adapterId
      );
      expect(session.configurationAdapterId.peek()).toBe(adapterId);
      const epoch = session.epoch.peek();
      yield* session.setWorkspaceRoot("/synthetic/probed", "synthetic.replacement");
      expect(session.epoch.peek()).toBe(epoch + 1);
    })
  );

  it.effect("cancels an in-flight read without switching or publishing its late failure", () =>
    Effect.gen(function* () {
      const response = yield* Deferred.make<unknown, ApiRequestError>();
      let interrupted = false;
      const { session, opener } = setup(() =>
        Deferred.await(response).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              interrupted = true;
            })
          )
        )
      );
      yield* session.setWorkspaceRoot("/synthetic/current", "synthetic.current-configuration");
      const pending = yield* opener.open("/synthetic/canceled").pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      opener.cancel();
      expect(yield* Fiber.join(pending)).toBe(false);
      yield* Deferred.fail(response, inspectFailure);
      expect(interrupted).toBe(true);
      expect(session.workspaceRoot.peek()).toBe("/synthetic/current");
      expect(session.configurationAdapterId.peek()).toBe("synthetic.current-configuration");
      expect(opener.failure.peek()).toBeUndefined();
      expect(opener.pending.peek()).toBeUndefined();
    })
  );
});
