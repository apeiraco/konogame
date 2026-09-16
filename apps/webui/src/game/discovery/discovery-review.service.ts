import { DiscoveryDisposition } from "@konogame/game/contracts";
import { ImportStatus } from "@konogame/workspace/contracts";
import { effect, type ReadonlySignal, signal } from "@preact/signals-core";
import { Context, Deferred, Effect, Layer } from "effect";
import {
  type ApiError,
  ApiRequestError,
  DAEMON_HTTP,
  type DaemonHttpService
} from "../../infrastructure/http/daemon-http.ts";
import {
  WORKSPACE_SESSION,
  type WorkspaceSession
} from "../../workspace/workspace-session.service.ts";
import { type AdmissionResult, type GameDiscoveryPreview } from "./discovery.read-model.ts";

export const ConfirmationKind = { Admit: "admit", Recover: "recover" } as const;
export type ConfirmationKind = (typeof ConfirmationKind)[keyof typeof ConfirmationKind];

export const DiscoveryFormErrorCode = {
  InvalidJson: "invalid-json",
  ScopeObjectRequired: "scope-object-required",
  PathsRequired: "paths-required"
} as const;
export type DiscoveryFormErrorCode =
  (typeof DiscoveryFormErrorCode)[keyof typeof DiscoveryFormErrorCode];

export interface DiscoveryFormError {
  readonly code: DiscoveryFormErrorCode;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface DiscoveryForm {
  readonly hostId: string;
  readonly sourceId: string;
  readonly paths: string;
  readonly depth: string | number;
  readonly exclude: string;
  readonly advanced: boolean;
  readonly scopeJson: string;
}

export interface DiscoveryReviewState {
  readonly form: DiscoveryForm;
  readonly preview?: GameDiscoveryPreview;
  readonly selection: Record<string, boolean>;
  readonly result?: AdmissionResult;
  readonly consumed: boolean;
  readonly confirmation?: ConfirmationKind;
  /** True when the dialog closed because its submission completed, not because it was cancelled. */
  readonly closedBySubmission: boolean;
  readonly confirmed: boolean;
  readonly previewPending: boolean;
  readonly admissionPending: boolean;
  readonly formError?: DiscoveryFormError;
  readonly previewError?: ApiError;
  readonly admissionError?: ApiError;
}

function initialState(): DiscoveryReviewState {
  return {
    form: {
      hostId: "",
      sourceId: "",
      paths: "",
      depth: 1,
      exclude: "",
      advanced: false,
      scopeJson: "{}"
    },
    selection: {},
    consumed: false,
    confirmed: false,
    closedBySubmission: false,
    previewPending: false,
    admissionPending: false
  };
}

export interface ReviewCache {
  readonly invalidate: (root: string) => Effect.Effect<void>;
}

export class REVIEW_CACHE extends Context.Service<REVIEW_CACHE, ReviewCache>()(
  "webui.review-cache"
) {}

/** Browser review state is a value tied to one session epoch, never an entity identity. */
export class DiscoveryReview {
  private readonly current = signal(initialState());
  readonly state: ReadonlySignal<DiscoveryReviewState> = this.current;
  private canceled = Deferred.makeUnsafe<void>();
  private generation = 0;
  private closed = false;

  constructor(
    private readonly session: WorkspaceSession,
    private readonly http: DaemonHttpService,
    private readonly cache: ReviewCache
  ) {}

  observeSession(): () => void {
    const unsubscribe = effect(() => {
      this.session.epoch.value;
      this.invalidate();
    });
    return () => {
      unsubscribe();
      this.closed = true;
      this.invalidate();
    };
  }

  private invalidate() {
    this.generation += 1;
    Deferred.doneUnsafe(this.canceled, Effect.void);
    this.canceled = Deferred.makeUnsafe<void>();
    this.current.value = initialState();
  }

  private patch(update: Partial<DiscoveryReviewState>) {
    this.current.value = { ...this.current.peek(), ...update };
  }

  private isBusy() {
    const state = this.current.peek();
    return state.previewPending || state.admissionPending;
  }

  private recoveryRequired() {
    return this.current.peek().result?.status === ImportStatus.RecoveryRequired;
  }

  updateForm(update: Partial<DiscoveryForm>): void {
    if (this.closed || this.isBusy() || this.recoveryRequired()) {
      return;
    }
    const previous = this.current.peek();
    const form = { ...previous.form, ...update };
    if (update.hostId !== undefined && update.hostId !== previous.form.hostId) {
      form.sourceId = "";
    }
    this.current.value = { ...initialState(), form };
  }

  select(
    update:
      | Record<string, boolean>
      | ((previous: Record<string, boolean>) => Record<string, boolean>)
  ): void {
    const state = this.current.peek();
    if (this.closed || this.isBusy() || state.consumed || state.confirmation) {
      return;
    }
    const requested = typeof update === "function" ? update(state.selection) : update;
    const selection = Object.fromEntries(
      (state.preview?.candidates ?? [])
        .filter(
          (item) =>
            item.disposition !== DiscoveryDisposition.Conflict && requested[item.candidateId]
        )
        .map((item) => [item.candidateId, true])
    );
    this.patch({ selection });
  }

  openConfirmation(kind: ConfirmationKind): void {
    const state = this.current.peek();
    if (this.closed || this.isBusy()) {
      return;
    }
    if (
      kind === ConfirmationKind.Recover
        ? !this.recoveryRequired()
        : !state.preview || state.consumed || !Object.keys(state.selection).length
    ) {
      return;
    }
    this.patch({ confirmation: kind, confirmed: false, closedBySubmission: false });
  }

  confirm(confirmed: boolean): void {
    if (!this.isBusy() && this.current.peek().confirmation) {
      this.patch({ confirmed });
    }
  }

  closeConfirmation(): void {
    if (!this.isBusy()) {
      this.patch({ confirmation: undefined, confirmed: false, closedBySubmission: false });
    }
  }

  preview(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const state = self.current.peek();
      const root = self.session.workspaceRoot.peek();
      if (
        self.closed ||
        !root ||
        self.isBusy() ||
        self.recoveryRequired() ||
        !state.form.hostId ||
        !state.form.sourceId
      ) {
        return;
      }
      const { form } = state;
      const lines = (value: string) =>
        value
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      let parsed: unknown;
      if (form.advanced) {
        try {
          parsed = JSON.parse(form.scopeJson);
        } catch {
          self.patch({ formError: { code: DiscoveryFormErrorCode.InvalidJson, params: {} } });
          return;
        }
      } else {
        if (!form.paths.trim()) {
          self.patch({ formError: { code: DiscoveryFormErrorCode.PathsRequired, params: {} } });
          return;
        }
        parsed = {
          paths: lines(form.paths),
          maxDepth: form.depth,
          exclude: lines(form.exclude)
        };
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        self.patch({ formError: { code: DiscoveryFormErrorCode.ScopeObjectRequired, params: {} } });
        return;
      }
      const scope = parsed as Record<string, unknown>;
      self.current.value = { ...initialState(), form, previewPending: true };
      const generation = self.generation;
      const canceled = self.canceled;
      yield* self.http
        .request<GameDiscoveryPreview>("/api/game-discovery-previews", {
          method: "POST",
          body: JSON.stringify({
            root,
            hostId: form.hostId,
            sourceId: form.sourceId,
            scope,
            configurationAdapterId: self.session.configurationAdapterId.peek()
          })
        })
        .pipe(
          Effect.match({
            onSuccess: (preview) => {
              if (generation === self.generation) {
                self.patch({ preview, previewPending: false });
              }
            },
            onFailure: (previewError) => {
              if (generation === self.generation) {
                self.patch({ previewError, previewPending: false });
              }
            }
          }),
          Effect.raceFirst(Deferred.await(canceled)),
          Effect.ensuring(
            Effect.sync(() => {
              if (generation === self.generation) {
                self.patch({ previewPending: false });
              }
            })
          )
        );
    });
  }

  submit(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const state = self.current.peek();
      const root = self.session.workspaceRoot.peek();
      if (self.closed || !root || self.isBusy() || !state.confirmed || !state.confirmation) {
        return;
      }
      const recover = state.confirmation === ConfirmationKind.Recover;
      if (
        recover
          ? !self.recoveryRequired()
          : !state.preview || state.consumed || !Object.keys(state.selection).length
      ) {
        return;
      }
      const body = recover
        ? {
            root,
            operationId: state.result?.operationId,
            confirmed: true,
            preferredAdapterId:
              state.preview?.configurationAdapterId ?? self.session.configurationAdapterId.peek()
          }
        : {
            root,
            preview: state.preview,
            selectedCandidateIds: Object.keys(state.selection),
            confirmed: true
          };
      const generation = self.generation;
      const canceled = self.canceled;
      // Consume before yielding so duplicate UI events cannot replay an approved review.
      self.patch({ consumed: true, admissionPending: true, admissionError: undefined });
      yield* self.http
        .request<AdmissionResult>(
          recover ? "/api/workspace/recover-import" : "/api/game-admissions",
          {
            method: "POST",
            body: JSON.stringify(body)
          }
        )
        .pipe(
          Effect.catch((error) => {
            if (
              error instanceof ApiRequestError &&
              error.body !== null &&
              typeof error.body === "object" &&
              "status" in error.body &&
              "operationId" in error.body
            ) {
              return Effect.succeed(error.body as AdmissionResult);
            }
            return Effect.fail(error);
          }),
          Effect.match({
            onSuccess: (result) => {
              if (generation === self.generation) {
                self.patch({
                  result,
                  confirmation: undefined,
                  confirmed: false,
                  closedBySubmission: true
                });
              }
            },
            onFailure: (admissionError) => {
              if (generation === self.generation) {
                self.patch({
                  admissionError,
                  confirmation: undefined,
                  confirmed: false,
                  closedBySubmission: true
                });
              }
            }
          }),
          Effect.raceFirst(Deferred.await(canceled)),
          Effect.ensuring(
            Effect.all(
              [
                self.cache.invalidate(root),
                Effect.sync(() => {
                  if (generation === self.generation) {
                    self.patch({ admissionPending: false });
                  }
                })
              ],
              { concurrency: "unbounded" }
            )
          )
        );
    });
  }
}

export class DISCOVERY_REVIEW extends Context.Service<DISCOVERY_REVIEW, DiscoveryReview>()(
  "webui.discovery-review"
) {}

export const discoveryReviewLayer = Layer.effect(
  DISCOVERY_REVIEW,
  Effect.gen(function* () {
    const [session, http, cache] = yield* Effect.all([
      WORKSPACE_SESSION,
      DAEMON_HTTP,
      REVIEW_CACHE
    ]);
    const review = new DiscoveryReview(session, http, cache);
    yield* Effect.acquireRelease(
      Effect.sync(() => review.observeSession()),
      (release) => Effect.sync(release)
    );
    return review;
  })
);
