import { Alert, Button, Code, Stack, Text } from "@mantine/core";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ApiDecodeError, ApiNetworkError, ApiPathError } from "../http/daemon-http.ts";
import { LOCALE } from "../i18n/locale.service.ts";

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const message =
    error instanceof ApiNetworkError
      ? t("common:error.network")
      : error instanceof ApiDecodeError
        ? t("common:error.decode")
        : error instanceof ApiPathError
          ? t("common:error.apiPath")
          : error instanceof Error
            ? error.message
            : String(error);
  const issues =
    error !== null && typeof error === "object" && "issues" in error ? error.issues : undefined;
  return (
    <Alert color="red" title={t("common:requestFailed")} role="alert">
      <Stack gap="xs">
        <Text size="sm">{message}</Text>
        {issues !== undefined && <Code block>{JSON.stringify(issues, null, 2)}</Code>}
        {retry && (
          <Button variant="light" color="red" onClick={retry}>
            {t("common:retry")}
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
