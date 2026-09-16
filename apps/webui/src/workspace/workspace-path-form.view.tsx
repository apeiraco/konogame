import { Button, TextInput } from "@mantine/core";
import { useHydrated } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { useWebUIService } from "../app/use-webui-service.ts";
import { describeError } from "../infrastructure/components/error-notice.view.tsx";
import { FolderIcon } from "../infrastructure/components/icons.tsx";
import { runUiEffect } from "../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../infrastructure/i18n/locale.service.ts";
import { WorkspaceBrowserDialog } from "./workspace-browser.view.tsx";
import { WORKSPACE_OPEN } from "./workspace-open.service.ts";
import { WORKSPACE_SESSION } from "./workspace-session.service.ts";

export const PathFormFocus = { Path: "path", Browse: "browse" } as const;
export type PathFormFocus = (typeof PathFormFocus)[keyof typeof PathFormFocus];

/**
 * Opens an existing Workspace root, typed or browsed. The daemon host interprets the path, and
 * the session switches only after the formal Workspace read succeeds.
 */
export function WorkspacePathForm({
  autoFocus,
  onOpened,
  onBrowse
}: {
  /** Which control a containing focus trap should focus first. */
  readonly autoFocus?: PathFormFocus;
  readonly onOpened?: () => void;
  /** When given, the owner shows the browse dialog; otherwise the form owns it. */
  readonly onBrowse?: () => void;
}) {
  const hydrated = useHydrated();
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const session = useWebUIService(WORKSPACE_SESSION);
  const opener = useWebUIService(WORKSPACE_OPEN);
  const ready = hydrated && session.isHydrated.value;
  const draftRoot = session.draftRoot.value;
  const pendingRoot = opener.pending.value;
  const failure = opener.failure.value;
  // Dialog visibility is transient presentation state.
  const [browsing, setBrowsing] = useState(false);
  const root = draftRoot.trim();
  useEffect(() => () => opener.cancel(), [opener]);
  function open(event: FormEvent) {
    event.preventDefault();
    if (!root || pendingRoot) {
      return;
    }
    void runUiEffect(opener.open(root)).then((opened) => {
      if (opened) {
        onOpened?.();
      }
    });
  }
  return (
    <>
      <form onSubmit={open} className="kg-path-form">
        <TextInput
          label={t("workspace:absolutePath")}
          description={t("workspace:pathHint")}
          placeholder={t("workspace:pathPlaceholder")}
          value={draftRoot}
          disabled={!ready}
          data-autofocus={autoFocus === PathFormFocus.Path || undefined}
          leftSection={<FolderIcon size={16} />}
          classNames={{ input: "kg-mono" }}
          spellCheck={false}
          autoComplete="off"
          error={
            failure && failure.root === root && !browsing
              ? t("workspace:openFailed", { reason: describeError(failure.error, t) })
              : undefined
          }
          onChange={(event) => {
            opener.cancel();
            session.setDraftRoot(event.currentTarget.value);
            opener.clearFailure();
          }}
        />
        <div className="kg-path-actions">
          <Button type="submit" disabled={!ready || !root} loading={pendingRoot === root && !!root}>
            {t("workspace:open")}
          </Button>
          <Button
            type="button"
            variant="default"
            disabled={!ready}
            data-autofocus={autoFocus === PathFormFocus.Browse || undefined}
            onClick={() => {
              opener.cancel();
              onBrowse ? onBrowse() : setBrowsing(true);
            }}
          >
            {t("workspace:browse")}
          </Button>
        </div>
      </form>
      {!onBrowse && (
        <WorkspaceBrowserDialog
          opened={browsing}
          onClose={() => setBrowsing(false)}
          onOpened={() => {
            setBrowsing(false);
            onOpened?.();
          }}
        />
      )}
    </>
  );
}
