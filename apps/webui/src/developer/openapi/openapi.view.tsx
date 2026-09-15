import { type ApiReferenceReact } from "@scalar/api-reference-react";
import { ClientOnly } from "@tanstack/react-router";
import { type ComponentProps, lazy, Suspense } from "react";
import { useWebUIService } from "../../app/use-webui-service.ts";
import { LOCALE } from "../../infrastructure/i18n/locale.service.ts";

const ScalarReference = lazy(async () => {
  const [{ ApiReferenceReact }] = await Promise.all([
    import("@scalar/api-reference-react"),
    import("@scalar/api-reference-react/style.css")
  ]);
  return { default: ApiReferenceReact };
});

export function fetchLocalApi(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input, window.location.href);
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return Promise.reject(new Error("API reference requests must use this daemon's /api/ routes"));
  }
  return window.fetch(input, { ...init, mode: "same-origin", redirect: "error" });
}

export const localApiReferenceConfiguration = {
  url: "/api/openapi.json",
  withDefaultFonts: false,
  telemetry: false,
  agent: { disabled: true },
  mcp: { disabled: true },
  // An empty proxy keeps requests local without a hosted request intermediary.
  proxyUrl: "",
  plugins: [],
  customFetch: fetchLocalApi,
  persistAuth: false,
  urlRouting: false,
  forceDarkModeState: "dark",
  hideClientButton: true,
  showDeveloperTools: "never"
} satisfies ComponentProps<typeof ApiReferenceReact>["configuration"];

export function ApiReferencePage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const language = locale.language.value;
  const loading = <p role="status">{t("developer:loading")}</p>;
  return (
    <section aria-label={t("developer:reference")} className="api-reference">
      <ClientOnly fallback={loading}>
        <Suspense fallback={loading}>
          <ScalarReference
            configuration={{
              ...localApiReferenceConfiguration,
              localization: { locale: language }
            }}
          />
        </Suspense>
      </ClientOnly>
    </section>
  );
}
