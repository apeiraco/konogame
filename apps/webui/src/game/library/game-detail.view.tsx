import { LocationValidationStatus } from "@konogame/infrastructure/contracts";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
  Title
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ErrorNotice } from "../../infrastructure/components/error-notice.view.tsx";
import { RawDetails } from "../../infrastructure/components/raw-details.view.tsx";
import { runUiEffect } from "../../infrastructure/effect/run-ui-effect.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";
import { WorkspaceRequired } from "../../workspace/workspace-required.view.tsx";
import { WORKSPACE_SESSION } from "../../workspace/workspace-session.service.ts";
import { coverPalette, installationAvailable } from "./library.model.ts";
import { libraryKeys } from "./library.query-keys.ts";
import { LIBRARY_SERVICE } from "./library.service.ts";

export function GameDetailPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const validationLabels = {
    [LocationValidationStatus.Valid]: t("library:validationValid"),
    [LocationValidationStatus.Invalid]: t("library:validationInvalid"),
    [LocationValidationStatus.Unverified]: t("library:validationUnverified")
  };
  const session = useWebUIService(WORKSPACE_SESSION);
  const workspaceRoot = session.workspaceRoot.value;
  const library = useWebUIService(LIBRARY_SERVICE);
  const { gameId } = useParams({ strict: false });
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: libraryKeys.game(workspaceRoot, gameId ?? ""),
    queryFn: ({ signal }) => runUiEffect(library.readGame(workspaceRoot, gameId ?? ""), signal),
    enabled: !!workspaceRoot && !!gameId
  });
  if (!workspaceRoot) {
    return <WorkspaceRequired />;
  }
  const game = query.data?.game;
  return (
    <Stack gap="lg">
      <Button
        variant="subtle"
        onClick={() => void navigate({ to: "/" })}
        style={{ alignSelf: "start" }}
      >
        ← {t("library:backToWall")}
      </Button>
      {query.isPending && <Loader aria-label={t("library:loadingDetail")} />}
      {query.isError && <ErrorNotice error={query.error} retry={() => void query.refetch()} />}
      {game && (
        <>
          <Group align="start" gap="xl">
            <Box
              aria-hidden="true"
              style={{
                ...coverPalette(game.id),
                width: 180,
                aspectRatio: "3 / 4",
                borderRadius: 12,
                padding: 20,
                color: "white",
                display: "flex",
                alignItems: "end"
              }}
            >
              <Text fw={700} size="xl">
                {game.title}
              </Text>
            </Box>
            <Stack gap="sm" style={{ flex: 1 }}>
              <Text size="sm" c="dimmed">
                {t("library:profile")}
              </Text>
              <Title order={1}>{game.title}</Title>
              {game.edition && <Text>{game.edition}</Text>}
              <Text size="sm" c="dimmed">
                {game.uniformName}
              </Text>
              <Text size="xs" c="dimmed">
                {game.id}
              </Text>
              <Alert title={t("library:launchUnavailableTitle")} color="gray">
                {t("library:launchUnavailableDescription")}
              </Alert>
            </Stack>
          </Group>
          <Divider />
          <Title order={2}>{t("library:installationLocations")}</Title>
          {!game.installations.length && <Text c="dimmed">{t("library:emptyInstallations")}</Text>}
          {game.installations.map((installation) => (
            <Card key={installation.id} withBorder>
              <Stack gap="sm">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>{installation.host.label}</Text>
                    <Text size="sm" c="dimmed">
                      {installation.sourceId} · {installation.host.platform}
                    </Text>
                  </div>
                  <Badge color={installationAvailable(installation) ? "teal" : "orange"}>
                    {installationAvailable(installation)
                      ? t("library:available")
                      : t("library:unavailable")}
                  </Badge>
                </Group>
                <Text size="sm">
                  {t("library:validation", {
                    status: validationLabels[installation.locationStatus.validation.status]
                  })}
                </Text>
                {installation.locationStatus.validation.reason && (
                  <Text size="sm" c="orange">
                    {installation.locationStatus.validation.reason}
                  </Text>
                )}
                {"reason" in installation.locationStatus.availability && (
                  <Text size="sm" c="orange">
                    {installation.locationStatus.availability.reason}
                  </Text>
                )}
                <RawDetails
                  label={t("library:rawLocation")}
                  value={{ location: installation.location, status: installation.locationStatus }}
                />
                <Text size="xs" c="dimmed">
                  {t("library:installationId", { id: installation.id })}
                </Text>
              </Stack>
            </Card>
          ))}
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
        </>
      )}
    </Stack>
  );
}
