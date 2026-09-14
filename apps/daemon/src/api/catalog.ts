import {
  ADAPTER_RESOLUTION_PLANNER,
  adapterResolutionPlanSchema,
  EXTENSION_CATALOG,
  RegistrationStatus
} from "@konogame/infrastructure";
import { SaveFeature } from "@konogame/save/contracts";
import { type } from "arktype";
import { Effect } from "effect";
import {
  catalogRefreshSchema,
  catalogStatusSchema,
  extensionListSchema
} from "./catalog-schemas.ts";
import { ApiError, ApiMethod, type ApiRoute, ApiStatus } from "./route.ts";

const planRequest = type({
  "+": "reject",
  features: type.string.atLeastLength(1).array().atLeastLength(1),
  "preferences?": { "[string]": "string" },
  "additionalCapabilities?": { "[string]": "string[]" }
});
const refreshRequest = type({ "+": "reject", "sourceId?": type.string.atLeastLength(1) });

export const catalogRoutes: readonly ApiRoute[] = [
  {
    method: ApiMethod.Get,
    path: "/api/health",
    operationId: "health",
    summary: "Check daemon health",
    responseSchema: {
      type: "object",
      properties: { status: { const: "ok" } },
      required: ["status"],
      additionalProperties: false
    },
    handler: () => Effect.succeed({ status: "ok" })
  },
  {
    method: ApiMethod.Get,
    path: "/api/features",
    operationId: "listFeatures",
    summary: "List available Feature identifiers",
    responseSchema: { type: "array", items: { type: "string" } },
    handler: () => Effect.flatMap(ADAPTER_RESOLUTION_PLANNER, (planner) => planner.features())
  },
  {
    method: ApiMethod.Post,
    path: "/api/plan",
    operationId: "planAdapters",
    summary: "Resolve selected Features with explicit Adapter preferences",
    requestSchema: planRequest.toJsonSchema(),
    responseSchema: adapterResolutionPlanSchema.toJsonSchema(),
    handler: ({ body }) =>
      Effect.gen(function* () {
        const request = planRequest(body);
        if (request instanceof type.errors) {
          return yield* Effect.fail(ApiError.badRequest(request.summary));
        }
        const planner = yield* ADAPTER_RESOLUTION_PLANNER;
        return yield* planner.plan(
          request.features,
          request.preferences,
          request.additionalCapabilities
        );
      })
  },
  {
    method: ApiMethod.Get,
    path: "/api/extensions",
    operationId: "listExtensions",
    summary: "List registered Extensions",
    responseSchema: extensionListSchema,
    handler: () => Effect.flatMap(EXTENSION_CATALOG, (catalog) => catalog.list())
  },
  {
    method: ApiMethod.Get,
    path: "/api/extension-catalog",
    operationId: "inspectExtensionCatalog",
    summary: "Inspect the Extension catalog, sources, Adapters and diagnostics",
    responseSchema: catalogStatusSchema,
    handler: () => Effect.flatMap(EXTENSION_CATALOG, (catalog) => catalog.status())
  },
  {
    method: ApiMethod.Get,
    path: "/api/extensions/{id}",
    operationId: "showExtension",
    summary: "Inspect one Extension and its Adapters",
    responseSchema: catalogStatusSchema,
    handler: ({ params }) =>
      Effect.flatMap(EXTENSION_CATALOG, (catalog) => catalog.status(params.id))
  },
  {
    method: ApiMethod.Post,
    path: "/api/extensions/refresh",
    operationId: "refreshExtensions",
    resultStatusCodes: { [RegistrationStatus.RestartRequired]: ApiStatus.Conflict },
    summary: "Refresh configured Extension discovery sources",
    requestSchema: refreshRequest.toJsonSchema(),
    responseSchema: catalogRefreshSchema,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const request = refreshRequest(body);
        if (request instanceof type.errors) {
          return yield* Effect.fail(ApiError.badRequest(request.summary));
        }
        const catalog = yield* EXTENSION_CATALOG;
        if (request.sourceId !== undefined) {
          const snapshot = yield* catalog.status();
          if (!snapshot.sources.some((source) => source.id === request.sourceId)) {
            return yield* Effect.fail(
              ApiError.notFound(`Unknown discovery source: ${request.sourceId}`)
            );
          }
        }
        return yield* catalog.refresh(request.sourceId);
      })
  }
];

export const legacyRoutes: readonly ApiRoute[] = [
  { ...catalogRoutes[0]!, path: "/health", operationId: "legacyHealth" },
  {
    method: ApiMethod.Get,
    path: "/plan",
    operationId: "legacyPlan",
    summary: "Resolve one Feature (legacy endpoint)",
    queryParameters: [{ name: "feature", schema: { type: "string", default: SaveFeature.Store } }],
    responseSchema: adapterResolutionPlanSchema.toJsonSchema(),
    handler: ({ query }) =>
      Effect.flatMap(ADAPTER_RESOLUTION_PLANNER, (planner) =>
        planner.plan([query.get("feature") ?? SaveFeature.Store])
      )
  }
];
