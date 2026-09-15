import "@mantine/core/styles.css";
import "../styles.css";
import { MantineProvider } from "@mantine/core";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { type ReactNode } from "react";
import { useWebUIService } from "../app/use-webui-service.ts";
import { type WebUIAppContext } from "../app/webui-app-context.ts";
import { LOCALE } from "../infrastructure/i18n/locale.service.ts";
import { AppShell } from "../layouts/app-shell.view.tsx";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
  appContext: WebUIAppContext;
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" }
    ]
  }),
  shellComponent: RootDocument,
  component: RootComponent,
  notFoundComponent: NotFoundPage
});

function RootDocument({ children }: { readonly children: ReactNode }) {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  const language = locale.language.value;
  return (
    <html lang={language}>
      <head>
        <HeadContent />
        <title>{t("shell:pageTitle")}</title>
        <meta name="description" content={t("shell:pageDescription")} />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function NotFoundPage() {
  const locale = useWebUIService(LOCALE);
  const t = locale.translator.value;
  return <p>{t("common:notFound")}</p>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider
        defaultColorScheme="dark"
        theme={{
          primaryColor: "teal",
          fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif"
        }}
      >
        <AppShell>
          <Outlet />
        </AppShell>
      </MantineProvider>
    </QueryClientProvider>
  );
}
