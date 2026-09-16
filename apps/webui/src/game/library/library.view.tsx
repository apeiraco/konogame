import { Button, SegmentedControl, Select, TextInput } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import {
  DiscoverIcon,
  GridIcon,
  ListIcon,
  RefreshIcon,
  SearchIcon
} from "../../infrastructure/components/icons.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { WORKSPACE_SESSION } from "../../workspace/workspace-session.service.ts";
import { WorkspaceWelcome } from "../../workspace/workspace-welcome.view.tsx";
import { CoverSize, GeneratedCover } from "./generated-cover.view.tsx";
import { InstallationStatePill } from "./installation-state.view.tsx";
import {
  filterGames,
  gameInstallationState,
  hasActiveFilter,
  LibraryAvailability,
  LibraryLayout,
  scopedInstallations
} from "./library.model.ts";
import { libraryKeys } from "./library.query-keys.ts";
import { type GameView } from "./library.read-model.ts";
import { LIBRARY_SERVICE } from "./library.service.ts";

const skeletonKeys = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;

// Roving movement between real card links; the browser keeps Tab order for everything else.
function moveCardFocus(
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  cards: ReadonlyMap<string, HTMLAnchorElement>,
  games: readonly GameView[]
) {
  if (!(event.target instanceof HTMLAnchorElement) || !container) {
    return;
  }
  const index = games.findIndex((game) => cards.get(game.id) === event.target);
  if (index < 0) {
    return;
  }
  const columns = Math.max(1, getComputedStyle(container).gridTemplateColumns.split(" ").length);
  const offset = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns,
    ArrowUp: -columns
  }[event.key];
  const targetIndex =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? games.length - 1
        : offset === undefined
          ? undefined
          : Math.min(games.length - 1, Math.max(0, index + offset));
  if (targetIndex === undefined) {
    return;
  }
  event.preventDefault();
  const target = games[targetIndex];
  if (target) {
    cards.get(target.id)?.focus();
  }
}

export function GameWallPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const language = locale.language.value;
  const session = useWebUIService(WORKSPACE_SESSION);
  const workspaceRoot = session.workspaceRoot.value;
  const configurationAdapterId = session.configurationAdapterId.value;
  const library = useWebUIService(LIBRARY_SERVICE);
  const layout = library.layout.value;
  const state = library.wall(workspaceRoot);
  const view = state.filter.value;
  const cards = useRef(new Map<string, HTMLAnchorElement>());
  const wall = useRef<HTMLUListElement>(null);
  const query = useQuery({
    queryKey: libraryKeys.library(workspaceRoot, configurationAdapterId),
    queryFn: ({ signal }) =>
      runUiEffect(library.readLibrary(workspaceRoot, configurationAdapterId), signal),
    enabled: !!workspaceRoot
  });
  const allGames = query.data?.games ?? [];
  const games = filterGames(allGames, view, language);

  useEffect(() => {
    // Opening a detail must not reactively consume its own return target before navigation.
    const returnFocusId = state.returnFocusId.peek();
    if (!returnFocusId || !query.data) {
      return;
    }
    const card = cards.current.get(returnFocusId);
    if (card) {
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: "center" });
      state.acknowledgeReturnFocus(returnFocusId);
    }
  }, [query.data, state]);

  if (!workspaceRoot) {
    return <WorkspaceWelcome />;
  }
  const hosts = [
    ...new Map(
      allGames.flatMap((game) =>
        game.installations.map((item) => [item.host.id, item.host] as const)
      )
    ).values()
  ];
  const sources = [
    ...new Set(
      allGames.flatMap((game) =>
        game.installations
          .filter((item) => !view.hostId || item.hostId === view.hostId)
          .map((item) => item.sourceId)
      )
    )
  ];
  const filtered = hasActiveFilter(view);
  return (
    <section className="kg-page" aria-labelledby="library-title">
      <header className="kg-page-head">
        <div>
          <p className="kg-eyebrow">{query.data?.workspace.name ?? t("library:eyebrow")}</p>
          <h1 id="library-title" className="kg-display">
            {t("library:wallTitle")}
          </h1>
          {query.data && (
            <p className="kg-count-line" aria-live="polite">
              {filtered
                ? t("library:gamesFiltered", { visible: games.length, count: allGames.length })
                : t("library:gamesCount", { count: allGames.length })}
            </p>
          )}
        </div>
        <div className="kg-page-actions">
          <Button
            variant="default"
            leftSection={<RefreshIcon size={16} />}
            onClick={() => void query.refetch()}
            loading={query.isFetching && !query.isPending}
            disabled={query.isPending}
          >
            {t("library:refreshLibrary")}
          </Button>
          <Button component={Link} to="/discovery" leftSection={<DiscoverIcon size={16} />}>
            {t("library:discover")}
          </Button>
        </div>
      </header>

      <search className="kg-toolbar" aria-label={t("library:filters")}>
        <TextInput
          className="kg-toolbar-search"
          aria-label={t("library:searchLabel")}
          placeholder={t("library:searchPlaceholder")}
          leftSection={<SearchIcon size={16} />}
          value={view.query}
          onChange={(event) => state.setQuery(event.currentTarget.value)}
        />
        <div role="radiogroup" aria-label={t("library:availabilityFilter")} className="kg-scroll-x">
          <SegmentedControl
            value={view.availability}
            onChange={(value) => state.setAvailability(value)}
            data={[
              { value: LibraryAvailability.All, label: t("library:allStatuses") },
              { value: LibraryAvailability.Available, label: t("library:stateAvailable") },
              { value: LibraryAvailability.Unavailable, label: t("library:stateUnavailable") },
              { value: LibraryAvailability.Unverified, label: t("library:stateUnverified") },
              { value: LibraryAvailability.Uninstalled, label: t("library:stateNone") }
            ]}
          />
        </div>
        <Select
          aria-label={t("library:hostFilter")}
          className="kg-toolbar-select"
          value={view.hostId || null}
          placeholder={t("library:allHosts")}
          clearable
          disabled={!hosts.length}
          data={hosts.map((host) => ({ value: host.id, label: host.label }))}
          onChange={(value) => state.selectHost(value ?? "")}
        />
        <Select
          aria-label={t("library:sourceFilter")}
          className="kg-toolbar-select"
          value={view.sourceId || null}
          placeholder={t("library:allSources")}
          clearable
          disabled={!sources.length}
          data={sources}
          onChange={(value) => state.selectSource(value ?? "")}
        />
        <div role="radiogroup" aria-label={t("library:layout")} className="kg-toolbar-layout">
          <SegmentedControl
            value={layout}
            onChange={(value) => library.setLayout(value)}
            data={[
              {
                value: LibraryLayout.Wall,
                label: (
                  <span className="kg-seg-label">
                    <GridIcon size={16} />
                    {t("library:layoutWall")}
                  </span>
                )
              },
              {
                value: LibraryLayout.List,
                label: (
                  <span className="kg-seg-label">
                    <ListIcon size={16} />
                    {t("library:layoutList")}
                  </span>
                )
              }
            ]}
          />
        </div>
      </search>

      {query.isError && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}

      {query.data && query.data.diagnostics.length > 0 && (
        <details className="kg-notice" data-tone="warning">
          <summary>
            {t("library:workspaceDiagnostics", { count: query.data.diagnostics.length })}
          </summary>
          <ul className="kg-plain-list">
            {query.data.diagnostics.map((item) => (
              <li key={`${item.path}:${item.message}`} className="kg-mono">
                {item.path}: {item.message}
              </li>
            ))}
          </ul>
        </details>
      )}

      {query.isPending && (
        <div className="kg-wall" data-layout={layout} aria-busy="true">
          <span className="kg-visually-hidden" role="status">
            {t("library:loadingLibrary")}
          </span>
          {skeletonKeys.map((key) => (
            <div key={key} className="kg-skeleton-card" aria-hidden="true" />
          ))}
        </div>
      )}

      {query.data &&
        (games.length === 0 ? (
          allGames.length ? (
            <div className="kg-empty">
              <h2>{t("library:emptyFilteredTitle")}</h2>
              <p>{t("library:emptyFilteredDescription")}</p>
              <Button variant="default" onClick={() => state.clearFilters()}>
                {t("library:clearFilters")}
              </Button>
            </div>
          ) : (
            <div className="kg-empty" data-variant="shelf">
              <div className="kg-welcome-shelf" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h2>{t("library:emptyTitle")}</h2>
              <p>{t("library:emptyDescription")}</p>
              <Button component={Link} to="/discovery" leftSection={<DiscoverIcon size={16} />}>
                {t("library:discover")}
              </Button>
            </div>
          )
        ) : (
          <>
            <p className="kg-hint" id="library-keyboard-hint">
              {t("library:keyboardHint")}
            </p>
            <ul
              className="kg-wall"
              data-layout={layout}
              ref={wall}
              aria-label={t("library:gameList")}
              aria-describedby="library-keyboard-hint"
              onKeyDown={(event) => moveCardFocus(event, wall.current, cards.current, games)}
            >
              {games.map((game) => {
                // Card facts use the same Host/source scope as the filter that admitted the card.
                const installations = scopedInstallations(game.installations, view);
                const installState = gameInstallationState(installations);
                const metaId = `game-meta-${game.id}`;
                return (
                  <li key={game.id} className="kg-wall-item">
                    <Link
                      to="/games/$gameId"
                      params={{ gameId: game.id }}
                      className="kg-card"
                      data-layout={layout}
                      ref={(element: HTMLAnchorElement | null) => {
                        if (element) {
                          cards.current.set(game.id, element);
                        } else {
                          cards.current.delete(game.id);
                        }
                      }}
                      onClick={() => state.rememberGame(game.id)}
                      aria-label={t("library:viewGame", { title: game.title })}
                      aria-describedby={metaId}
                    >
                      <GeneratedCover
                        id={game.id}
                        title={game.title}
                        size={layout === LibraryLayout.Wall ? CoverSize.Card : CoverSize.Thumb}
                      />
                      <span className="kg-card-body">
                        <span className="kg-card-title" title={game.title}>
                          {game.title}
                        </span>
                        {game.edition && <span className="kg-card-edition">{game.edition}</span>}
                        <span className="kg-card-meta" id={metaId}>
                          <InstallationStatePill state={installState} />
                          {installations.length > 1 && (
                            <span className="kg-card-count">
                              {t("library:installationCount", {
                                count: installations.length
                              })}
                            </span>
                          )}
                          {layout === LibraryLayout.List && installations.length > 0 && (
                            <span className="kg-card-hosts">
                              {[...new Set(installations.map((item) => item.host.label))].join(
                                " · "
                              )}
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ))}
    </section>
  );
}
