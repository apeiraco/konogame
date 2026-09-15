import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { WorkspaceRequired } from "../../workspace/workspace-required.view.tsx";
import { WORKSPACE_SESSION } from "../../workspace/workspace-session.service.ts";
import {
  coverPalette,
  filterGames,
  installationAvailable,
  LibraryAvailability
} from "./library.model.ts";
import { libraryKeys } from "./library.query-keys.ts";
import { LIBRARY_SERVICE } from "./library.service.ts";

export function GameWallPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const session = useWebUIService(WORKSPACE_SESSION);
  const workspaceRoot = session.workspaceRoot.value;
  const library = useWebUIService(LIBRARY_SERVICE);
  const state = library.wall(workspaceRoot);
  const view = state.filter.value;
  const cards = useRef(new Map<string, HTMLAnchorElement>());
  const wall = useRef<HTMLDivElement>(null);
  const query = useQuery({
    queryKey: libraryKeys.library(workspaceRoot),
    queryFn: ({ signal }) => runUiEffect(library.readLibrary(workspaceRoot), signal),
    enabled: !!workspaceRoot
  });
  const games = filterGames(query.data?.games ?? [], view, locale.language.value);

  useEffect(() => {
    // Opening a detail must not reactively consume its own return target before navigation.
    const returnFocusId = state.returnFocusId.peek();
    if (!returnFocusId || !query.data) {
      return;
    }
    const card = cards.current.get(returnFocusId);
    if (card) {
      card.focus();
      card.scrollIntoView({ block: "nearest" });
      state.acknowledgeReturnFocus(returnFocusId);
    }
  }, [query.data, state]);
  const hosts = [
    ...new Map(
      (query.data?.games ?? []).flatMap((game) =>
        game.installations.map((item) => [item.host.id, item.host] as const)
      )
    ).values()
  ];
  const sources = [
    ...new Set(
      (query.data?.games ?? []).flatMap((game) =>
        game.installations
          .filter((item) => !view.hostId || item.hostId === view.hostId)
          .map((item) => item.sourceId)
      )
    )
  ];

  if (!workspaceRoot) {
    return <WorkspaceRequired />;
  }
  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Text size="sm" c="dimmed">
            {t("library:eyebrow")}
          </Text>
          <Title order={1}>{t("library:wallTitle")}</Title>
        </div>
        <Button component={Link} to="/discovery">
          {t("library:discover")}
        </Button>
      </Group>
      <Group align="end">
        <TextInput
          label={t("library:searchLabel")}
          placeholder={t("library:searchPlaceholder")}
          value={view.query}
          onChange={(event) => state.setQuery(event.currentTarget.value)}
          style={{ flex: 1, minWidth: 200 }}
        />
        <Select
          label={t("library:hostFilter")}
          value={view.hostId || null}
          placeholder={t("library:allHosts")}
          clearable
          data={hosts.map((host) => ({ value: host.id, label: host.label }))}
          onChange={(value) => state.selectHost(value ?? "")}
        />
        <Select
          label={t("library:sourceFilter")}
          value={view.sourceId || null}
          placeholder={t("library:allSources")}
          clearable
          data={sources}
          onChange={(value) => state.selectSource(value ?? "")}
        />
        <Select
          label={t("library:availabilityFilter")}
          value={view.availability}
          onChange={(value) => state.setAvailability(value)}
          data={[
            { value: LibraryAvailability.All, label: t("library:allStatuses") },
            { value: LibraryAvailability.Available, label: t("library:available") },
            { value: LibraryAvailability.Unavailable, label: t("library:unavailable") },
            { value: LibraryAvailability.Uninstalled, label: t("library:uninstalled") }
          ]}
        />
      </Group>
      {query.isPending && <Loader aria-label={t("library:loadingLibrary")} />}
      {query.isError && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
      {query.data && (
        <>
          <Group justify="space-between">
            <Text c="dimmed" aria-live="polite">
              {t("library:gamesCount", { visible: games.length, count: query.data.games.length })}
            </Text>
            <Button
              variant="subtle"
              size="xs"
              onClick={() => void query.refetch()}
              loading={query.isFetching}
            >
              {t("library:refreshLibrary")}
            </Button>
          </Group>
          {query.data.diagnostics.length > 0 && (
            <Alert color="yellow" title={t("library:workspaceDiagnostics")}>
              {query.data.diagnostics.map((item) => (
                <Text key={`${item.path}:${item.message}`} size="sm">
                  {item.path}: {item.message}
                </Text>
              ))}
            </Alert>
          )}
          {games.length === 0 ? (
            <Card withBorder p="xl">
              <Stack align="center">
                <Title order={2}>
                  {query.data.games.length
                    ? t("library:emptyFilteredTitle")
                    : t("library:emptyTitle")}
                </Title>
                <Text c="dimmed">
                  {query.data.games.length
                    ? t("library:emptyFilteredDescription")
                    : t("library:emptyDescription")}
                </Text>
                <Button variant="light" component={Link} to="/discovery">
                  {t("library:discover")}
                </Button>
              </Stack>
            </Card>
          ) : (
            <>
              <Text size="xs" c="dimmed">
                {t("library:keyboardHint")}
              </Text>
              <SimpleGrid
                cols={{ base: 2, xs: 3, md: 4, lg: 5 }}
                spacing="lg"
                ref={wall}
                aria-label={t("library:gameList")}
                onKeyDown={(event) => {
                  if (!(event.target instanceof HTMLAnchorElement)) {
                    return;
                  }
                  const index = games.findIndex(
                    (game) => cards.current.get(game.id) === event.target
                  );
                  if (index < 0 || !wall.current) {
                    return;
                  }
                  const columns = getComputedStyle(wall.current).gridTemplateColumns.split(
                    " "
                  ).length;
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
                    cards.current.get(target.id)?.focus();
                  }
                }}
              >
                {games.map((game) => (
                  <Link
                    key={game.id}
                    to="/games/$gameId"
                    params={{ gameId: game.id }}
                    ref={(element: HTMLAnchorElement | null) => {
                      if (element) {
                        cards.current.set(game.id, element);
                      } else {
                        cards.current.delete(game.id);
                      }
                    }}
                    onClick={() => state.rememberGame(game.id)}
                    aria-label={t("library:viewGame", { title: game.title })}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    <Card withBorder padding={0} h="100%">
                      <Box
                        aria-hidden="true"
                        p="md"
                        style={{
                          ...coverPalette(game.id),
                          aspectRatio: "3 / 4",
                          display: "flex",
                          flexDirection: "column",
                          justifyContent: "space-between",
                          color: "white"
                        }}
                      >
                        <Text size="xs" opacity={0.6}>
                          K / LIBRARY
                        </Text>
                        <Text fw={700} size="xl" style={{ overflowWrap: "anywhere" }}>
                          {game.title}
                        </Text>
                        <Text size="xs" opacity={0.5}>
                          {t("library:coverPlaceholder")}
                        </Text>
                      </Box>
                      <Stack gap={6} p="sm">
                        <Text fw={600} lineClamp={2}>
                          {game.title}
                        </Text>
                        {game.edition && (
                          <Text size="xs" c="dimmed">
                            {game.edition}
                          </Text>
                        )}
                        <Badge
                          size="xs"
                          variant="light"
                          color={game.installations.some(installationAvailable) ? "teal" : "gray"}
                        >
                          {!game.installations.length
                            ? t("library:uninstalled")
                            : game.installations.some(installationAvailable)
                              ? t("library:available")
                              : t("library:unavailable")}
                        </Badge>
                      </Stack>
                    </Card>
                  </Link>
                ))}
              </SimpleGrid>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
