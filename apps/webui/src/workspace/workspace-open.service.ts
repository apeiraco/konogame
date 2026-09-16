import { batch, type ReadonlySignal, signal } from "@preact/signals-core";
import { Context, Deferred, Effect, Layer } from "effect";
import { type ApiError } from "../infrastructure/http/daemon-http.ts";
import { WORKSPACE_QUERY, type WorkspaceQueryService } from "./workspace-query.service.ts";
import { WORKSPACE_SESSION, type WorkspaceSession } from "./workspace-session.service.ts";

export interface WorkspaceOpenFailure {
  readonly root: string;
  readonly error: ApiError;
}

/**
 * Opens a Workspace only after the formal read succeeds. Typed paths and browsed locations share
 * this check, so a failed open leaves the current session untouched.
 */
export class WorkspaceOpenService {
  private readonly pendingRoot = signal<string | undefined>(undefined);
  private readonly lastFailure = signal<WorkspaceOpenFailure | undefined>(undefined);
  private generation = 0;
  private canceled = Deferred.makeUnsafe<void>();
  readonly pending: ReadonlySignal<string | undefined> = this.pendingRoot;
  readonly failure: ReadonlySignal<WorkspaceOpenFailure | undefined> = this.lastFailure;

  constructor(
    private readonly session: WorkspaceSession,
    private readonly query: WorkspaceQueryService
  ) {}

  /** Succeeds with true when the session switched to `root`. A newer open wins over older ones. */
  open(root: string, preferredAdapterId?: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      self.cancel();
      const generation = self.generation;
      const canceled = self.canceled;
      batch(() => {
        self.pendingRoot.value = root;
        self.lastFailure.value = undefined;
      });
      const current = () => generation === self.generation;
      let configurationAdapterId = preferredAdapterId;
      const opened = yield* self.query.inspect(root, preferredAdapterId).pipe(
        Effect.match({
          onSuccess: (inspection) => {
            configurationAdapterId =
              inspection.adapterResolutionPlan?.resolvedAdapters[0]?.adapterId ??
              preferredAdapterId;
            return true;
          },
          onFailure: (error) => {
            if (current()) {
              self.lastFailure.value = { root, error };
            }
            return false;
          }
        }),
        Effect.raceFirst(Deferred.await(canceled).pipe(Effect.as(false))),
        Effect.ensuring(
          Effect.sync(() => {
            if (current()) {
              self.pendingRoot.value = undefined;
            }
          })
        )
      );
      if (!opened || !current()) {
        return false;
      }
      yield* self.session.setWorkspaceRoot(root, configurationAdapterId);
      return true;
    });
  }

  /** Invalidates a pending open when its presentation is dismissed or its selection changes. */
  cancel(): void {
    this.generation += 1;
    Deferred.doneUnsafe(this.canceled, Effect.void);
    this.canceled = Deferred.makeUnsafe<void>();
    this.pendingRoot.value = undefined;
  }

  clearFailure(): void {
    this.lastFailure.value = undefined;
  }
}

export class WORKSPACE_OPEN extends Context.Service<WORKSPACE_OPEN, WorkspaceOpenService>()(
  "webui/WorkspaceOpen"
) {}

export const workspaceOpenLayer = Layer.effect(
  WORKSPACE_OPEN,
  Effect.gen(function* () {
    const [session, query] = yield* Effect.all([WORKSPACE_SESSION, WORKSPACE_QUERY]);
    return new WorkspaceOpenService(session, query);
  })
);
