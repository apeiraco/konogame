import { NativeSelect } from "@mantine/core";
import { Link, useHydrated } from "@tanstack/react-router";
import { type ReactNode, useRef } from "react";
import { useWebUIService } from "../app/use-webui-service.ts";
import { CodeIcon, DiscoverIcon, LibraryIcon } from "../infrastructure/components/icons.tsx";
import { runUiEffect } from "../infrastructure/effect/run-ui-effect.ts";
import {
  InterfaceLanguage,
  isInterfaceLanguage,
  LOCALE
} from "../infrastructure/i18n/locale.service.ts";
import { WorkspaceSwitcher } from "../workspace/workspace-switcher.view.tsx";

export function AppShell({ children }: { readonly children: ReactNode }) {
  const hydrated = useHydrated();
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const language = locale.language.value;
  const localeHydrated = locale.isHydrated.value;
  const main = useRef<HTMLElement>(null);
  return (
    <div className="kg-shell">
      <button type="button" className="kg-skip-link" onClick={() => main.current?.focus()}>
        {t("shell:skipToContent")}
      </button>
      <header className="kg-topbar">
        <Link to="/" className="kg-brand" aria-label={t("shell:brandHome")}>
          <span className="kg-brand-seal" aria-hidden="true">
            こ
          </span>
          <span className="kg-brand-word">
            konogame
            <small>{t("shell:brandTagline")}</small>
          </span>
        </Link>
        <nav aria-label={t("shell:mainNavigation")} className="kg-nav">
          <Link
            to="/"
            activeOptions={{ exact: true, includeSearch: false }}
            className="kg-nav-link"
            activeProps={{ "aria-current": "page", className: "is-active" }}
          >
            <LibraryIcon />
            <span>{t("shell:library")}</span>
          </Link>
          <Link
            to="/discovery"
            className="kg-nav-link"
            activeProps={{ "aria-current": "page", className: "is-active" }}
          >
            <DiscoverIcon />
            <span>{t("shell:discovery")}</span>
          </Link>
        </nav>
        <div className="kg-topbar-tools">
          <WorkspaceSwitcher />
          <NativeSelect
            id="interface-language"
            data-testid="interface-language"
            aria-label={t("shell:language")}
            className="kg-language"
            size="xs"
            value={language}
            disabled={!hydrated || !localeHydrated}
            data={[
              { value: InterfaceLanguage.Chinese, label: "中文" },
              { value: InterfaceLanguage.English, label: "EN" }
            ]}
            onChange={(event) => {
              const selected = event.currentTarget.value;
              if (isInterfaceLanguage(selected)) {
                void runUiEffect(locale.setLanguage(selected));
              }
            }}
          />
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1} className="kg-main">
        {children}
      </main>
      <footer className="kg-footer">
        <span>{t("shell:footerLocal")}</span>
        <Link to="/developer/openapi" className="kg-footer-link">
          <CodeIcon size={14} />
          {t("shell:developerReference")}
        </Link>
        <span>{t("shell:footerExperimental")}</span>
      </footer>
    </div>
  );
}
