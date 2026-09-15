import { it as effectIt } from "@effect/vitest";
import { type AdmissionCandidate, GAME_DISCOVERY_PREVIEW_SCHEMA } from "@konogame/game/admission";
import { DiscoveryDisposition, GamePort } from "@konogame/game/contracts";
import {
  DECLARATION_PROTOCOL_VERSION,
  LocationValidationStatus
} from "@konogame/infrastructure/contracts";
import { ImportStatus } from "@konogame/workspace/contracts";
import { Context, Deferred, Effect, Exit, Fiber, Layer, Queue, Scope } from "effect";
import { describe, expect, it } from "vitest";
import {
  type ApiError,
  ApiNetworkError,
  ApiRequestError,
  DAEMON_HTTP,
  type DaemonHttpService
} from "../../../infrastructure/http/daemon-http.ts";
import {
  WORKSPACE_SESSION,
  WorkspaceSession
} from "../../../workspace/workspace-session.service.ts";
import { type GameDiscoveryPreview } from "../discovery.read-model.ts";
import {
  ConfirmationKind,
  DISCOVERY_REVIEW,
  DiscoveryFormErrorCode,
  discoveryReviewLayer,
  REVIEW_CACHE
} from "../discovery-review.service.ts";

const root = "/synthetic/workspace-a";
const candidateId = "019a0000-0000-7000-8000-000000000001";
const operationId = "019a0000-0000-7000-8000-000000000002";
const hostId = "019a0000-0000-7000-8000-000000000003";
const candidate: AdmissionCandidate = {
  candidateId,
  observationKey: "synthetic/one",
  title: "Synthetic game",
  location: { type: "synthetic.location", schemaVersion: "1.0.0", data: {} },
  evidence: [{ kind: "synthetic", path: "/synthetic/game", fingerprint: "one" }],
  externalRefs: [],
  provenance: {
    adapterId: "synthetic.discovery",
    port: GamePort.Discovery,
    hostId,
    sourceId: "loose"
  },
  disposition: DiscoveryDisposition.NewGame,
  locationValidation: { status: LocationValidationStatus.Valid }
};
const preview: GameDiscoveryPreview = {
  schemaVersion: GAME_DISCOVERY_PREVIEW_SCHEMA,
  operationId,
  createdAt: "2026-01-01T00:00:00Z",
  root,
  workspaceId: "019a0000-0000-7000-8000-000000000004",
  revision: "one",
  hostId,
  sourceId: "loose",
  sourceKind: "synthetic",
  scope: { paths: ["/synthetic/games"] },
  discoveryAdapterId: "synthetic.discovery",
  configurationAdapterId: "synthetic.configuration",
  candidates: [
    candidate,
    {
      ...candidate,
      candidateId: "019a0000-0000-7000-8000-000000000005",
      observationKey: "synthetic/conflict",
      disposition: DiscoveryDisposition.Conflict
    }
  ],
  diagnostics: [],
  adapterResolutionPlan: {
    declarationProtocolVersion: DECLARATION_PROTOCOL_VERSION,
    resolvedAdapters: [],
    unavailable: []
  },
  digest: "a".repeat(64)
};

interface ObservedRequest {
  readonly path: string;
  readonly body: unknown;
  readonly response: Deferred.Deferred<unknown, ApiError>;
  interrupted: boolean;
}

class TestHttp implements DaemonHttpService {
  constructor(readonly requests: Queue.Queue<ObservedRequest>) {}
  request<T>(path: string, init?: RequestInit): Effect.Effect<T, ApiError> {
    const self = this;
    return Effect.gen(function* () {
      const response = yield* Deferred.make<unknown, ApiError>();
      const request: ObservedRequest = {
        path,
        body: JSON.parse(String(init?.body)),
        response,
        interrupted: false
      };
      yield* Queue.offer(self.requests, request);
      return yield* Deferred.await(response).pipe(
        Effect.map((value) => value as T),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            request.interrupted = true;
          })
        )
      );
    });
  }
}

const setup = Effect.gen(function* () {
  const requests = yield* Queue.unbounded<ObservedRequest>();
  const session = new WorkspaceSession(() => undefined);
  const invalidations: string[] = [];
  const dependencies = Layer.mergeAll(
    Layer.succeed(WORKSPACE_SESSION, session),
    Layer.succeed(DAEMON_HTTP, new TestHttp(requests)),
    Layer.succeed(REVIEW_CACHE, {
      invalidate: (value) =>
        Effect.sync(() => {
          invalidations.push(value);
        })
    })
  );
  const services = yield* Layer.build(discoveryReviewLayer.pipe(Layer.provide(dependencies)));
  const review = Context.get(services, DISCOVERY_REVIEW);
  yield* session.setWorkspaceRoot(root);
  review.updateForm({ hostId, sourceId: "loose", paths: "/synthetic/games" });
  // A Host change clears its dependent source; selecting that source is a separate action.
  review.updateForm({ sourceId: "loose" });
  return { review, session, requests, invalidations };
});

function generatePreview(
  review: Effect.Success<typeof setup>["review"],
  requests: Queue.Queue<ObservedRequest>
) {
  return Effect.gen(function* () {
    const running = yield* review.preview().pipe(Effect.forkChild);
    const request = yield* Queue.take(requests);
    yield* Deferred.succeed(request.response, preview);
    yield* Fiber.join(running);
  });
}

describe("browser discovery review service", () => {
  effectIt.effect("reports local scope errors as semantic values without issuing requests", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { review, requests } = yield* setup;
        review.updateForm({ paths: "  " });
        yield* review.preview();
        expect(review.state.peek().formError).toEqual({
          code: DiscoveryFormErrorCode.PathsRequired,
          params: {}
        });
        review.updateForm({ advanced: true, scopeJson: "{" });
        yield* review.preview();
        expect(review.state.peek().formError).toEqual({
          code: DiscoveryFormErrorCode.InvalidJson,
          params: {}
        });
        for (const scopeJson of ["null", "[]", "1", '"scope"']) {
          review.updateForm({ scopeJson });
          yield* review.preview();
          expect(review.state.peek().formError).toEqual({
            code: DiscoveryFormErrorCode.ScopeObjectRequired,
            params: {}
          });
        }
        expect(yield* Queue.size(requests)).toBe(0);
        review.updateForm({ advanced: false, paths: "/synthetic/games" });
        expect(review.state.peek().formError).toBeUndefined();
        yield* generatePreview(review, requests);
        expect(review.state.peek().preview).toEqual(preview);
      })
    )
  );

  it("cancels an old preview and rejects its completion after leaving and returning to the same root", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { review, session, requests } = yield* setup;
          const old = yield* review.preview().pipe(Effect.forkChild);
          const request = yield* Queue.take(requests);
          yield* session.setWorkspaceRoot("/synthetic/workspace-b");
          yield* session.setWorkspaceRoot(root);
          yield* Deferred.succeed(request.response, preview);
          yield* Fiber.join(old);
          expect(request.interrupted).toBe(true);
          expect(review.state.peek().preview).toBeUndefined();
          expect(review.state.peek().form.hostId).toBe("");
          review.updateForm({ hostId, paths: "/synthetic/other" });
          review.updateForm({ sourceId: "loose" });
          yield* generatePreview(review, requests);
          expect(review.state.peek().preview?.operationId).toBe(operationId);
        })
      )
    );
  });

  it("requires explicit confirmation, filters conflicts, blocks duplicate admission, and explicitly confirms recovery", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { review, requests, invalidations } = yield* setup;
          yield* generatePreview(review, requests);
          review.select(
            Object.fromEntries(preview.candidates.map((item) => [item.candidateId, true]))
          );
          expect(Object.keys(review.state.peek().selection)).toEqual([candidateId]);
          review.openConfirmation(ConfirmationKind.Admit);
          yield* review.submit();
          expect(yield* Queue.size(requests)).toBe(0);
          review.confirm(true);
          const running = yield* review.submit().pipe(Effect.forkChild);
          const request = yield* Queue.take(requests);
          yield* review.submit();
          expect(yield* Queue.size(requests)).toBe(0);
          expect(request.path).toBe("/api/game-admissions");
          expect(request.body).toMatchObject({
            root,
            selectedCandidateIds: [candidateId],
            confirmed: true
          });
          yield* Deferred.fail(
            request.response,
            new ApiRequestError(409, { status: ImportStatus.RecoveryRequired, operationId })
          );
          yield* Fiber.join(running);
          expect(review.state.peek().consumed).toBe(true);
          review.updateForm({ paths: "/synthetic/blocked" });
          expect(review.state.peek().form.paths).toBe("/synthetic/games");
          review.openConfirmation(ConfirmationKind.Recover);
          expect(review.state.peek().confirmed).toBe(false);
          yield* review.submit();
          expect(yield* Queue.size(requests)).toBe(0);
          review.confirm(true);
          const recovery = yield* review.submit().pipe(Effect.forkChild);
          const recoveryRequest = yield* Queue.take(requests);
          expect(recoveryRequest.path).toBe("/api/workspace/recover-import");
          expect(recoveryRequest.body).toEqual({ root, operationId, confirmed: true });
          yield* Deferred.succeed(recoveryRequest.response, {
            status: ImportStatus.Imported,
            operationId
          });
          yield* Fiber.join(recovery);
          expect(review.state.peek().result?.status).toBe(ImportStatus.Imported);
          expect(invalidations).toEqual([root, root]);
        })
      )
    );
  });

  it("consumes a failed submission and invalidates its captured root without publishing into another session", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { review, session, requests, invalidations } = yield* setup;
          yield* generatePreview(review, requests);
          review.select({ [candidateId]: true });
          review.openConfirmation(ConfirmationKind.Admit);
          review.confirm(true);
          const running = yield* review.submit().pipe(Effect.forkChild);
          const request = yield* Queue.take(requests);
          const failure = new ApiNetworkError({
            path: request.path,
            cause: new Error("synthetic disconnect")
          });
          yield* Deferred.fail(request.response, failure);
          yield* Fiber.join(running);
          expect(review.state.peek().admissionError).toBe(failure);
          expect(review.state.peek().consumed).toBe(true);
          review.openConfirmation(ConfirmationKind.Admit);
          yield* review.submit();
          expect(yield* Queue.size(requests)).toBe(0);
          yield* session.setWorkspaceRoot("/synthetic/workspace-b");
          expect(review.state.peek().admissionError).toBeUndefined();
          expect(invalidations).toEqual([root]);
        })
      )
    );
  });

  it("cancels in-flight admission on a root change and invalidates only the request's root", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { review, session, requests, invalidations } = yield* setup;
          yield* generatePreview(review, requests);
          review.select({ [candidateId]: true });
          review.openConfirmation(ConfirmationKind.Admit);
          review.confirm(true);
          const running = yield* review.submit().pipe(Effect.forkChild);
          const request = yield* Queue.take(requests);
          yield* session.setWorkspaceRoot("/synthetic/workspace-b");
          yield* session.setWorkspaceRoot(root);
          yield* Deferred.succeed(request.response, { status: ImportStatus.Imported, operationId });
          yield* Fiber.join(running);
          expect(request.interrupted).toBe(true);
          expect(review.state.peek().result).toBeUndefined();
          expect(review.state.peek().confirmation).toBeUndefined();
          expect(invalidations).toEqual([root]);
        })
      )
    );
  });

  it("releases its session subscription and cancels its pending transport when the owner scope closes", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* Scope.make();
          const { review, session, requests } = yield* setup.pipe(
            Effect.provideService(Scope.Scope, owner)
          );
          const running = yield* review.preview().pipe(Effect.forkChild);
          const request = yield* Queue.take(requests);
          yield* Scope.close(owner, Exit.succeed(undefined));
          yield* Fiber.join(running);
          expect(request.interrupted).toBe(true);
          yield* session.setWorkspaceRoot("/synthetic/workspace-b");
          review.updateForm({ hostId, paths: "/synthetic/games" });
          review.updateForm({ sourceId: "loose" });
          yield* review.preview();
          expect(review.state.peek().form.hostId).toBe("");
          expect(yield* Queue.size(requests)).toBe(0);
        })
      )
    );
  });
});
