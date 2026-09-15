import { expect, test } from "vitest";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { WorkspaceSession } from "../workspace-session.service.ts";

test("restores storage only at hydration and preserves an independent fallback when storage denies access", async () => {
  const session = new WorkspaceSession(() => ({
    getItem: () => "/synthetic/stored",
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
