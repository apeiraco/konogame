import { expect, test } from "vitest";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { WorkspaceSession } from "../workspace-session.service.ts";

test("restores storage only at hydration and preserves an independent fallback when storage denies access", async () => {
  const session = new WorkspaceSession(() => ({
    getItem: () => JSON.stringify({ root: "/synthetic/stored" }),
    setItem: () => {
      throw new Error("blocked");
    }
  }));
  expect(session.workspaceRoot.peek()).toBe("");
  expect(session.isHydrated.peek()).toBe(false);
  await runUiEffect(session.hydrate);
  expect(session.isHydrated.peek()).toBe(true);
  expect(session.workspaceRoot.peek()).toBe("/synthetic/stored");
  await runUiEffect(session.setWorkspaceRoot("/synthetic/current"));
  expect(session.workspaceRoot.peek()).toBe("/synthetic/current");
  expect(session.draftRoot.peek()).toBe("/synthetic/current");
  expect(session.epoch.peek()).toBe(2);
  await runUiEffect(session.hydrate);
  expect(session.workspaceRoot.peek()).toBe("/synthetic/current");
  const denied = new WorkspaceSession(() => {
    throw new Error("blocked");
  });
  await runUiEffect(denied.hydrate);
  expect(denied.isHydrated.peek()).toBe(true);
  await runUiEffect(denied.setWorkspaceRoot("/synthetic/fallback"));
  expect(denied.workspaceRoot.peek()).toBe("/synthetic/fallback");
});

test("publishes draft edits synchronously after hydration without changing the selected root", async () => {
  const session = new WorkspaceSession(() => undefined);
  await runUiEffect(session.hydrate);
  session.setDraftRoot("/synthetic/draft");
  expect(session.draftRoot.peek()).toBe("/synthetic/draft");
  expect(session.workspaceRoot.peek()).toBe("");
  expect(session.epoch.peek()).toBe(0);
});

test("restores the configuration Adapter with the root after a browser reload", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    }
  };
  const first = new WorkspaceSession(() => storage);
  await runUiEffect(first.setWorkspaceRoot("/synthetic/selected", "synthetic.configuration"));
  const reloaded = new WorkspaceSession(() => storage);
  await runUiEffect(reloaded.hydrate);
  expect(reloaded.workspaceRoot.peek()).toBe("/synthetic/selected");
  expect(reloaded.configurationAdapterId.peek()).toBe("synthetic.configuration");
  await runUiEffect(reloaded.setWorkspaceRoot("/synthetic/manual"));
  const manualReload = new WorkspaceSession(() => storage);
  await runUiEffect(manualReload.hydrate);
  expect(manualReload.configurationAdapterId.peek()).toBeUndefined();
});

test("keeps a stored root and Adapter together when the next storage write fails", async () => {
  let stored: string | null = null;
  let blocked = false;
  let writes = 0;
  const storage = {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      writes++;
      if (blocked) {
        throw new Error("Storage denied");
      }
      stored = value;
    }
  };
  const session = new WorkspaceSession(() => storage);
  await runUiEffect(session.setWorkspaceRoot("/synthetic/first", "synthetic.first"));
  blocked = true;
  await runUiEffect(session.setWorkspaceRoot("/synthetic/second", "synthetic.second"));
  expect(writes).toBe(2);
  expect(session.workspaceRoot.peek()).toBe("/synthetic/second");
  const reloaded = new WorkspaceSession(() => storage);
  await runUiEffect(reloaded.hydrate);
  expect(reloaded.workspaceRoot.peek()).toBe("/synthetic/first");
  expect(reloaded.configurationAdapterId.peek()).toBe("synthetic.first");
});
