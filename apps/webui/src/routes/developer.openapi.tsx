import { createFileRoute, lazyRouteComponent } from "@tanstack/react-router";

export const Route = createFileRoute("/developer/openapi")({
  component: lazyRouteComponent(
    () => import("../developer/openapi/openapi.view.tsx"),
    "ApiReferencePage"
  )
});
