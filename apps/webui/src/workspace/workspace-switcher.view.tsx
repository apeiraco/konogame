import { Popover, UnstyledButton } from "@mantine/core";
import { useState } from "react";
import { useWebUIService } from "../app/use-webui-service.ts";
import { FolderIcon } from "../infrastructure/components/icons.tsx";
import { LOCALE } from "../infrastructure/i18n/locale.service.ts";
import { WorkspaceBrowserDialog } from "./workspace-browser.view.tsx";
import { WORKSPACE_OPEN } from "./workspace-open.service.ts";
import { PathFormFocus, WorkspacePathForm } from "./workspace-path-form.view.tsx";
import { WORKSPACE_SESSION } from "./workspace-session.service.ts";

export function WorkspaceSwitcher() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const session = useWebUIService(WORKSPACE_SESSION);
  const opener = useWebUIService(WORKSPACE_OPEN);
  const workspaceRoot = session.workspaceRoot.value;
  // Popover and dialog visibility are transient presentation state; the Workspace lives in the session.
  const [opened, setOpened] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  // After a cancelled browse, the reopened popover focuses Browse instead of the path field.
  const [focus, setFocus] = useState<PathFormFocus>(PathFormFocus.Path);
  return (
    <>
      <Popover
        opened={opened}
        onChange={(value) => {
          setOpened(value);
          if (!value) {
            opener.cancel();
            setFocus(PathFormFocus.Path);
          }
        }}
        position="bottom-end"
        // Never wider than the viewport minus the page gutters; shift keeps it inside the edges.
        width="min(420px, calc(100vw - 32px))"
        middlewares={{ flip: true, shift: { padding: 16 } }}
        trapFocus
        returnFocus={!browsing}
        withinPortal
      >
        <Popover.Target>
          <UnstyledButton
            className="kg-workspace-chip"
            aria-haspopup="dialog"
            aria-expanded={opened}
            aria-label={t("shell:switchWorkspace")}
            title={workspaceRoot || undefined}
            onClick={() => {
              if (opened) {
                opener.cancel();
              }
              setOpened((value) => !value);
            }}
          >
            <FolderIcon size={16} />
            <span className="kg-workspace-chip-text">
              <small>{t("shell:workspaceLabel")}</small>
              <span className={workspaceRoot ? "kg-mono" : undefined}>
                {workspaceRoot || t("shell:noWorkspace")}
              </span>
            </span>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown aria-label={t("shell:switchWorkspace")} role="dialog">
          <div className="kg-switcher">
            <p className="kg-eyebrow">{t("shell:switchWorkspace")}</p>
            {workspaceRoot && (
              <p className="kg-switcher-current">
                <span>{t("shell:currentWorkspace")}</span>
                <code className="kg-mono">{workspaceRoot}</code>
              </p>
            )}
            <WorkspacePathForm
              autoFocus={focus}
              onOpened={() => setOpened(false)}
              // A modal nested in the popover would fight its focus trap; hand over instead.
              onBrowse={() => {
                setBrowsing(true);
                setOpened(false);
              }}
            />
          </div>
        </Popover.Dropdown>
      </Popover>
      <WorkspaceBrowserDialog
        opened={browsing}
        returnFocus={false}
        onClose={() => {
          setBrowsing(false);
          setFocus(PathFormFocus.Browse);
          setOpened(true);
        }}
        onOpened={() => setBrowsing(false)}
      />
    </>
  );
}
