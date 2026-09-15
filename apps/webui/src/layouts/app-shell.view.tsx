import { Badge, Button, Group, NativeSelect, Text, TextInput } from "@mantine/core";
import { Link, useHydrated } from "@tanstack/react-router";
import { type FormEvent, type ReactNode } from "react";
import { useWebUIService } from "../app/use-webui-service.ts";
import { runUiEffect } from "../infrastructure/effect/run-ui-effect.ts";
import {
  InterfaceLanguage,
  isInterfaceLanguage,
  LOCALE
} from "../infrastructure/i18n/locale.service.ts";
import { WORKSPACE_SESSION } from "../workspace/workspace-session.service.ts";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  const session = useWebUIService(WORKSPACE_SESSION);
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const language = locale.language.value;
  const localeHydrated = locale.isHydrated.value;
  const sessionHydrated = session.isHydrated.value;
  const workspaceRoot = session.workspaceRoot.value;
  const draftRoot = session.draftRoot.value;
  function openWorkspace(event: FormEvent) {
    event.preventDefault();
    void runUiEffect(session.setWorkspaceRoot(draftRoot.trim()));
  }
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">こ</span>
          <span>
            konogame<small>このゲーム</small>
          </span>
        </Link>
        <Text className="nav-caption" size="xs">
          {t("shell:workspace")}
        </Text>
        <nav aria-label={t("shell:mainNavigation")}>
          <Link
            to="/"
            activeOptions={{ exact: true }}
            activeProps={{ className: "nav-link active" }}
            className="nav-link"
          >
            <span aria-hidden>▦</span>
            {t("shell:library")}
          </Link>
          <Link to="/discovery" activeProps={{ className: "nav-link active" }} className="nav-link">
            <span aria-hidden>⌕</span>
            {t("shell:discovery")}
          </Link>
        </nav>
        <div className="app-sidebar-bottom">
          <Badge variant="dot" color="teal">
            {t("shell:localWorkspace")}
          </Badge>
          <Link to="/developer/openapi" className="developer-link">
            {t("shell:developerReference")}
          </Link>
          <Text size="xs" c="dimmed">
            {t("shell:experimental")}
          </Text>
          <NativeSelect
            id="interface-language"
            data-testid="interface-language"
            label={t("shell:language")}
            value={language}
            disabled={!hydrated || !localeHydrated}
            data={[
              { value: InterfaceLanguage.Chinese, label: "简体中文" },
              { value: InterfaceLanguage.English, label: "English" }
            ]}
            onChange={(event) => {
              const selected = event.currentTarget.value;
              if (isInterfaceLanguage(selected)) {
                void runUiEffect(locale.setLanguage(selected));
              }
            }}
          />
        </div>
      </aside>
      <div className="main-column">
        <header className="workspace-bar">
          <div>
            <Text fw={600} size="sm">
              {t("shell:myWorkspace")}
            </Text>
            <Text c="dimmed" size="xs">
              {workspaceRoot || t("shell:selectWorkspace")}
            </Text>
          </div>
          <form onSubmit={openWorkspace} className="workspace-form">
            <Group gap="xs">
              <TextInput
                aria-label={t("shell:absolutePath")}
                placeholder={t("shell:pathPlaceholder")}
                value={draftRoot}
                disabled={!hydrated || !sessionHydrated}
                onChange={(event) => {
                  session.setDraftRoot(event.currentTarget.value);
                }}
                size="xs"
              />
              <Button
                type="submit"
                size="xs"
                variant="light"
                disabled={!hydrated || !sessionHydrated || !draftRoot.trim()}
              >
                {t("shell:open")}
              </Button>
            </Group>
          </form>
        </header>
        <main className="page-content">{children}</main>
        <footer className="app-footer">{t("shell:footer")}</footer>
      </div>
    </div>
  );
}
