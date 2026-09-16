import { LocationValidationStatus } from "@konogame/infrastructure/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { BackIcon } from "../../infrastructure/components/icons.tsx";
import { RawDetails } from "../../infrastructure/components/raw-details.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { WORKSPACE_SESSION } from "../../workspace/workspace-session.service.ts";
import { WorkspaceWelcome } from "../../workspace/workspace-welcome.view.tsx";
import { CoverSize, GeneratedCover } from "./generated-cover.view.tsx";
import { InstallationStatePill } from "./installation-state.view.tsx";
import { gameInstallationState, installationState } from "./library.model.ts";
import { libraryKeys } from "./library.query-keys.ts";
import { LIBRARY_SERVICE } from "./library.service.ts";

export function GameDetailPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const collator = new Intl.Collator(locale.language.value);
  const validationLabels = {
    [LocationValidationStatus.Valid]: t("library:validationValid"),
    [LocationValidationStatus.Invalid]: t("library:validationInvalid"),
    [LocationValidationStatus.Unverified]: t("library:validationUnverified")
  };
  const session = useWebUIService(WORKSPACE_SESSION);
  const workspaceRoot = session.workspaceRoot.value;
  const configurationAdapterId = session.configurationAdapterId.value;
  const library = useWebUIService(LIBRARY_SERVICE);
  const { gameId } = useParams({ strict: false });
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  const query = useQuery({
    queryKey: libraryKeys.game(workspaceRoot, gameId ?? "", configurationAdapterId),
    queryFn: ({ signal }) =>
      runUiEffect(library.readGame(workspaceRoot, gameId ?? "", configurationAdapterId), signal),
    enabled: !!workspaceRoot && !!gameId
  });
  const game = query.data?.game;
  const loadedId = game?.id;

  useEffect(() => {
    // Move keyboard and screen reader position to the newly opened profile once.
    if (loadedId) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [loadedId]);

  if (!workspaceRoot) {
    return <WorkspaceWelcome />;
  }
  const installations = [...(game?.installations ?? [])].sort(
    (a, b) =>
      collator.compare(a.host.label, b.host.label) || collator.compare(a.sourceId, b.sourceId)
  );
  const hostCount = new Set(installations.map((item) => item.hostId)).size;
  return (
    <article
      className="kg-page kg-detail"
      aria-labelledby="game-title"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !(event.target instanceof HTMLInputElement) &&
          !(event.target instanceof HTMLTextAreaElement)
        ) {
          event.preventDefault();
          void navigate({ to: "/" });
        }
      }}
    >
      <Link to="/" className="kg-back-link">
        <BackIcon size={16} />
        {t("library:backToWall")}
      </Link>
      {query.isPending && (
        <div className="kg-detail-hero" aria-busy="true">
          <span className="kg-visually-hidden" role="status">
            {t("library:loadingDetail")}
          </span>
          <div className="kg-skeleton-card" data-size="hero" aria-hidden="true" />
        </div>
      )}
      {query.isError && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
      {game && (
        <>
          <header className="kg-detail-hero">
            <GeneratedCover id={game.id} title={game.title} size={CoverSize.Hero} />
            <div className="kg-detail-heading">
              <p className="kg-eyebrow">{t("library:profile")}</p>
              <h1 id="game-title" ref={heading} tabIndex={-1} className="kg-display">
                {game.title}
              </h1>
              {game.edition && <p className="kg-detail-edition">{game.edition}</p>}
              <div className="kg-detail-facts">
                <InstallationStatePill state={gameInstallationState(game.installations)} />
                <span>{t("library:installationCount", { count: installations.length })}</span>
                {hostCount > 0 && <span>{t("library:hostCount", { count: hostCount })}</span>}
              </div>
              <p className="kg-detail-note">{t("library:launchUnavailable")}</p>
              <p className="kg-hint">{t("library:detailKeyboardHint")}</p>
            </div>
          </header>

          <section className="kg-section" aria-labelledby="installations-title">
            <h2 id="installations-title" className="kg-section-title">
              {t("library:installationLocations")}
            </h2>
            {!installations.length && (
              <div className="kg-empty" data-variant="inline">
                <p>{t("library:emptyInstallations")}</p>
                <Link to="/discovery" className="kg-text-link">
                  {t("library:discover")}
                </Link>
              </div>
            )}
            <ul className="kg-installations">
              {installations.map((installation) => {
                const status = installation.locationStatus;
                return (
                  <li key={installation.id} className="kg-installation">
                    <div className="kg-installation-head">
                      <div>
                        <p className="kg-installation-host">{installation.host.label}</p>
                        <p className="kg-installation-source">
                          {t("library:sourceLine", {
                            source: installation.sourceId,
                            kind: installation.source?.kind ?? t("common:unknown"),
                            platform: installation.host.platform
                          })}
                        </p>
                      </div>
                      <InstallationStatePill state={installationState(installation)} />
                    </div>
                    <dl className="kg-facts">
                      <div>
                        <dt>{t("library:locationType")}</dt>
                        <dd className="kg-mono">
                          {installation.location.type}@{installation.location.schemaVersion}
                        </dd>
                      </div>
                      <div>
                        <dt>{t("library:validationLabel")}</dt>
                        <dd>{validationLabels[status.validation.status]}</dd>
                      </div>
                      {status.validation.reason && (
                        <div>
                          <dt>{t("library:validationReason")}</dt>
                          <dd>{status.validation.reason}</dd>
                        </div>
                      )}
                      {"reason" in status.availability && (
                        <div>
                          <dt>{t("library:availabilityReason")}</dt>
                          <dd>{status.availability.reason}</dd>
                        </div>
                      )}
                    </dl>
                    <RawDetails
                      label={t("library:rawLocation")}
                      value={{ location: installation.location, status }}
                    />
                    <p className="kg-id-line kg-mono">
                      {t("library:installationId", { id: installation.id })}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="kg-section" aria-labelledby="identity-title">
            <h2 id="identity-title" className="kg-section-title">
              {t("library:identity")}
            </h2>
            <dl className="kg-facts" data-columns="2">
              <div>
                <dt>{t("library:gameId")}</dt>
                <dd className="kg-mono">{game.id}</dd>
              </div>
              <div>
                <dt>{t("library:uniformName")}</dt>
                <dd className="kg-mono">{game.uniformName}</dd>
              </div>
            </dl>
            {game.externalRefs.length > 0 && (
              <ul className="kg-ref-list">
                {game.externalRefs.map((ref) => (
                  <li key={JSON.stringify(ref)} className="kg-mono">
                    {ref.authority} · {ref.kind} ·{" "}
                    {Object.entries(ref.key)
                      .map(([name, value]) => `${name}=${value}`)
                      .join(", ")}
                  </li>
                ))}
              </ul>
            )}
            <RawDetails
              label={t("library:externalReferences")}
              value={{
                externalRefs: game.externalRefs,
                externalIdentities: game.externalIdentities ?? []
              }}
            />
            <RawDetails
              label={t("library:adapterDiagnostics")}
              value={{
                plan: query.data?.adapterResolutionPlan,
                diagnostics: query.data?.diagnostics
              }}
            />
          </section>
        </>
      )}
    </article>
  );
}
