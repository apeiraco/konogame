import { adapterResolutionPlanSchema } from "@konogame/infrastructure";
import { locationContractSchema, toTransmittedSchema } from "@konogame/infrastructure/contracts";
import { WORKSPACE_BROWSE } from "@konogame/workspace/browse";
import {
  text,
  workspaceBrowseLimitSchema,
  workspaceBrowseListingSchema,
  workspaceProbeResultSchema
} from "@konogame/workspace/contracts";
import { type } from "arktype";
import { Effect } from "effect";
import { readApiQuery, validateApiInput } from "./request-input.ts";
import { ApiMethod, type ApiRoute } from "./route.ts";

const emptyQuery = type({ "+": "reject" });
const listRequest = type({
  "+": "reject",
  "location?": locationContractSchema,
  "limit?": workspaceBrowseLimitSchema
});
const probeRequest = type({
  "+": "reject",
  location: locationContractSchema,
  "preferredAdapterId?": text
});
const listResponse = type.merge(workspaceBrowseListingSchema, {
  adapterResolutionPlan: adapterResolutionPlanSchema
});
const probeResponse = type.merge(workspaceProbeResultSchema, {
  "adapterResolutionPlan?": adapterResolutionPlanSchema
});

// Both routes are read-only. POST carries a complete Location object instead of a path string.
const routes: readonly ApiRoute[] = [
  {
    method: ApiMethod.Post,
    path: "/api/workspace/locations",
    operationId: "workspaceBrowseLocations",
    summary:
      "List one level of locations where a Workspace may be opened; without a location, list starting points",
    requestSchema: toTransmittedSchema(listRequest),
    responseSchema: toTransmittedSchema(listResponse),
    handler: ({ body }) =>
      Effect.gen(function* () {
        const input = yield* validateApiInput(listRequest, body);
        return yield* (yield* WORKSPACE_BROWSE).list(input);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/locations/probe",
    operationId: "workspaceProbeLocation",
    summary:
      "Check one selected location for a Workspace configuration marker without reading its records",
    requestSchema: toTransmittedSchema(probeRequest),
    responseSchema: toTransmittedSchema(probeResponse),
    handler: ({ body }) =>
      Effect.gen(function* () {
        return yield* (yield* WORKSPACE_BROWSE).probe(yield* validateApiInput(probeRequest, body));
      })
  }
];

export const workspaceBrowseRoutes: readonly ApiRoute[] = routes.map((route) => ({
  ...route,
  handler: (request) =>
    Effect.gen(function* () {
      yield* validateApiInput(emptyQuery, yield* readApiQuery(request.query));
      return yield* route.handler(request);
    })
}));
