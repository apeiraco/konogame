import { Alert } from "@mantine/core";
import { useWebUIService } from "../app/use-webui-service.ts";
import { LOCALE } from "../infrastructure/i18n/locale.service.ts";

export function WorkspaceRequired() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return <Alert title={t("workspace:requiredTitle")}>{t("workspace:required")}</Alert>;
}
