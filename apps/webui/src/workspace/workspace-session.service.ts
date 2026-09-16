import { batch, type ReadonlySignal, signal } from "@preact/signals-core";
import { Context, Effect, Layer } from "effect";

export interface SessionStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export class SESSION_STORAGE extends Context.Service<
  SESSION_STORAGE,
  { readonly open: () => SessionStorage | undefined }
>()("webui/SessionStorage") {}

export const workspaceSessionKey = "konogame.workspace-selection";

export class WorkspaceSession {
  private readonly root = signal("");
  private readonly adapter = signal<string | undefined>(undefined);
  private readonly generation = signal(0);
  private readonly draft = signal("");
  private readonly hydration = signal(false);
  readonly workspaceRoot: ReadonlySignal<string> = this.root;
  readonly configurationAdapterId: ReadonlySignal<string | undefined> = this.adapter;
  readonly epoch: ReadonlySignal<number> = this.generation;
  readonly draftRoot: ReadonlySignal<string> = this.draft;
  readonly isHydrated: ReadonlySignal<boolean> = this.hydration;

  constructor(private readonly openStorage: () => SessionStorage | undefined) {}

  readonly hydrate = Effect.sync(() => {
    if (this.hydration.peek()) {
      return;
    }
    batch(() => {
      try {
        const stored = this.openStorage()?.getItem(workspaceSessionKey);
        const selection: unknown = stored ? JSON.parse(stored) : undefined;
        if (
          selection &&
          typeof selection === "object" &&
          "root" in selection &&
          typeof selection.root === "string"
        ) {
          const adapterId =
            "configurationAdapterId" in selection ? selection.configurationAdapterId : undefined;
          if (adapterId === undefined || (typeof adapterId === "string" && !!adapterId)) {
            this.replaceRoot(selection.root, adapterId);
          }
        }
      } catch {
        // Storage denial leaves this page's independent session usable.
      } finally {
        this.hydration.value = true;
      }
    });
  });

  setDraftRoot(root: string): void {
    this.draft.value = root;
  }

  setWorkspaceRoot(root: string, configurationAdapterId?: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.replaceRoot(root, configurationAdapterId);
      try {
        this.openStorage()?.setItem(
          workspaceSessionKey,
          JSON.stringify({ root, configurationAdapterId })
        );
      } catch {
        // Persistence is optional; it must not block a Workspace selection.
      }
    });
  }

  private replaceRoot(root: string, configurationAdapterId?: string) {
    batch(() => {
      if (this.root.peek() !== root || this.adapter.peek() !== configurationAdapterId) {
        this.generation.value++;
        this.root.value = root;
        this.adapter.value = configurationAdapterId;
      }
      this.draft.value = root;
    });
  }
}

export class WORKSPACE_SESSION extends Context.Service<WORKSPACE_SESSION, WorkspaceSession>()(
  "webui/WorkspaceSession"
) {}
export const workspaceSessionLayer = Layer.effect(
  WORKSPACE_SESSION,
  Effect.map(SESSION_STORAGE, (storage) => new WorkspaceSession(storage.open))
);
export function provideSessionStorage(open: () => SessionStorage | undefined) {
  return Layer.succeed(SESSION_STORAGE, { open });
}
