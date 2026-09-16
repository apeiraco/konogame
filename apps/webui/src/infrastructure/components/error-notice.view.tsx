import { Button } from "@mantine/core";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { ApiDecodeError, ApiNetworkError, ApiPathError } from "../http/daemon-http.ts";
import { LOCALE, type Translator } from "../i18n/locale.service.ts";
import { AlertIcon, RefreshIcon } from "./icons.tsx";
import { RawDetails } from "./raw-details.view.tsx";

/** Daemon diagnostics stay in their original language; only transport failures are localized. */
export function describeError(error: unknown, t: Translator): string {
  return error instanceof ApiNetworkError
    ? t("common:error.network")
    : error instanceof ApiDecodeError
      ? t("common:error.decode")
      : error instanceof ApiPathError
        ? t("common:error.apiPath")
        : error instanceof Error
          ? error.message
          : String(error);
}

export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const message = describeError(error, t);
  const issues =
    error !== null && typeof error === "object" && "issues" in error ? error.issues : undefined;
  return (
    <div className="kg-notice" data-tone="danger" role="alert">
      <AlertIcon />
      <div className="kg-notice-body">
        <p className="kg-notice-title">{t("common:requestFailed")}</p>
        <p>{message}</p>
        {issues !== undefined && <RawDetails label={t("common:technicalDetails")} value={issues} />}
      </div>
      {retry && (
        <Button variant="default" size="xs" leftSection={<RefreshIcon size={14} />} onClick={retry}>
          {t("common:retry")}
        </Button>
      )}
    </div>
  );
}
