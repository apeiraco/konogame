import { useWebUIService } from "../app/use-webui-service.ts";
import { LOCALE } from "../infrastructure/i18n/locale.service.ts";
import { WorkspacePathForm } from "./workspace-path-form.view.tsx";

/** Shown wherever a feature needs a Workspace and none is open yet. */
export function WorkspaceWelcome() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return (
    <section className="kg-welcome" aria-labelledby="workspace-welcome-title">
      <div className="kg-welcome-shelf" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="kg-welcome-body">
        <p className="kg-eyebrow">{t("workspace:welcomeEyebrow")}</p>
        <h1 id="workspace-welcome-title" className="kg-display">
          {t("workspace:welcomeTitle")}
        </h1>
        <p className="kg-lede">{t("workspace:welcomeDescription")}</p>
        <WorkspacePathForm />
        <ul className="kg-welcome-points">
          <li>
            <strong>{t("workspace:pointBrowseTitle")}</strong>
            <span>{t("workspace:pointBrowse")}</span>
          </li>
          <li>
            <strong>{t("workspace:pointReviewTitle")}</strong>
            <span>{t("workspace:pointReview")}</span>
          </li>
          <li>
            <strong>{t("workspace:pointLocalTitle")}</strong>
            <span>{t("workspace:pointLocal")}</span>
          </li>
        </ul>
      </div>
    </section>
  );
}
