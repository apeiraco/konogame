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

export const workspaceSessionKey = "konogame.workspace-root";

export class WorkspaceSession {
  private readonly root = signal("");
  private readonly generation = signal(0);
  private readonly draft = signal("");
  private readonly hydration = signal(false);
  readonly workspaceRoot: ReadonlySignal<string> = this.root;
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
        this.replaceRoot(this.openStorage()?.getItem(workspaceSessionKey) ?? "");
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

  setWorkspaceRoot(root: string): Effect.Effect<void> {
    return Effect.sync(() => {
      this.replaceRoot(root);
      try {
        this.openStorage()?.setItem(workspaceSessionKey, root);
      } catch {
        // Persistence is optional; it must not block a Workspace selection.
      }
    });
  }

  private replaceRoot(root: string) {
    batch(() => {
      if (this.root.peek() !== root) {
        this.generation.value++;
        this.root.value = root;
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
