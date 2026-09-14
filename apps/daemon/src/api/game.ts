import {
  GAME_ADMISSION,
  gameDiscoveryPreviewSchema,
  previewGameDiscoveryInputSchema
} from "@konogame/game/admission";
import { toTransmittedSchema } from "@konogame/infrastructure/contracts";
import { ImportStatus, uuidSchema } from "@konogame/workspace/contracts";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Effect } from "effect";
import {
  discoveryInputProjectionSchema,
  discoveryPreviewProjectionSchema,
  emptyQuerySchema,
  gameAdmissionBodySchema,
  gameAdmissionProjectionSchema,
  gameListQuerySchema,
  gameListResponseSchema,
  gamePathSchema,
  gameShowQuerySchema,
  gameShowResponseSchema
} from "./game-schemas.ts";
import { requireAbsolutePath } from "./path-input.ts";
import { readApiQuery, validateApiInput } from "./request-input.ts";
import { ApiError, ApiMethod, type ApiRoute, ApiStatus } from "./route.ts";
import { importRecoveryResponseSchema } from "./workspace-schemas.ts";

export const gameRoutes = [
  {
    method: ApiMethod.Get,
    path: "/api/games",
    operationId: "listGames",
    summary: "List Workspace Games and their Installation availability",
    queryParameters: [
      { name: "root", required: true, schema: { type: "string", minLength: 1 } },
      { name: "hostId", schema: toTransmittedSchema(uuidSchema) },
      { name: "sourceId", schema: { type: "string", minLength: 1 } },
      { name: "preferredAdapterId", schema: { type: "string", minLength: 1 } }
    ],
    responseSchema: toTransmittedSchema(gameListResponseSchema),
    handler: ({ query }): Effect.Effect<unknown, unknown, WORKSPACE_MANAGEMENT> =>
      Effect.gen(function* () {
        const input = yield* validateApiInput(gameListQuerySchema, yield* readApiQuery(query));
        yield* requireAbsolutePath(input.root, "root");
        const { root, ...selection } = input;
        return yield* (yield* WORKSPACE_MANAGEMENT).listGames(root, selection);
      })
  },
  {
    method: ApiMethod.Get,
    path: "/api/games/{gameId}",
    operationId: "showGame",
    summary: "Show a Workspace Game and its Installations",
    pathParameters: [{ name: "gameId", schema: toTransmittedSchema(uuidSchema) }],
    queryParameters: [
      { name: "root", required: true, schema: { type: "string", minLength: 1 } },
      { name: "preferredAdapterId", schema: { type: "string", minLength: 1 } }
    ],
    responseSchema: toTransmittedSchema(gameShowResponseSchema),
    handler: ({ query, params }): Effect.Effect<unknown, unknown, WORKSPACE_MANAGEMENT> =>
      Effect.gen(function* () {
        const [input, path] = yield* Effect.all([
          validateApiInput(gameShowQuerySchema, yield* readApiQuery(query)),
          validateApiInput(gamePathSchema, params)
        ]);
        yield* requireAbsolutePath(input.root, "root");
        return yield* (yield* WORKSPACE_MANAGEMENT).showGame(
          input.root,
          path.gameId,
          input.preferredAdapterId
        );
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/game-discovery-previews",
    operationId: "previewGameDiscovery",
    summary: "Preview discovery within an explicit configured Host, source and Adapter scope",
    requestSchema: toTransmittedSchema(discoveryInputProjectionSchema),
    responseSchema: toTransmittedSchema(discoveryPreviewProjectionSchema),
    handler: ({ query, body }): Effect.Effect<unknown, unknown, GAME_ADMISSION> =>
      Effect.gen(function* () {
        yield* validateApiInput(emptyQuerySchema, yield* readApiQuery(query));
        const input = yield* validateApiInput(previewGameDiscoveryInputSchema, body);
        yield* requireAbsolutePath(input.root, "root");
        return yield* (yield* GAME_ADMISSION).preview(input);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/game-admissions",
    operationId: "admitGames",
    resultStatusCodes: {
      [ImportStatus.Conflict]: ApiStatus.Conflict,
      [ImportStatus.RecoveryRequired]: ApiStatus.Conflict,
      [ImportStatus.Failed]: ApiStatus.Unprocessable
    },
    summary:
      "Admit explicitly selected and confirmed discovery candidates after owner revalidation",
    requestSchema: toTransmittedSchema(gameAdmissionProjectionSchema),
    responseSchema: toTransmittedSchema(importRecoveryResponseSchema),
    handler: ({ query, body }): Effect.Effect<unknown, unknown, GAME_ADMISSION> =>
      Effect.gen(function* () {
        yield* validateApiInput(emptyQuerySchema, yield* readApiQuery(query));
        const input = yield* validateApiInput(gameAdmissionBodySchema, body);
        yield* requireAbsolutePath(input.root, "root");
        const preview = yield* validateApiInput(gameDiscoveryPreviewSchema, input.preview);
        if (new Set(input.selectedCandidateIds).size !== input.selectedCandidateIds.length) {
          return yield* Effect.fail(ApiError.badRequest("selectedCandidateIds must be unique"));
        }
        const { confirmed: _, ...admission } = input;
        return yield* (yield* GAME_ADMISSION).import({ ...admission, preview });
      })
  }
] as const satisfies readonly ApiRoute[];
