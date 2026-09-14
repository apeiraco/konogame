import { toTransmittedSchema } from "@konogame/infrastructure/contracts";
import { SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { text, uuidSchema } from "@konogame/workspace/contracts";
import { type } from "arktype";
import { Effect } from "effect";
import { DAEMON_ARTIFACT_INPUT } from "../artifact-input.ts";
import { emptyQuerySchema } from "./game-schemas.ts";
import { requireAbsolutePath } from "./path-input.ts";
import { readApiQuery, validateApiInput } from "./request-input.ts";
import { ApiMethod, type ApiRoute } from "./route.ts";

const saveBodySchema = type({
  "+": "reject",
  directory: text,
  "preferredAdapterId?": text
});
const artifactReferenceSchema = type({ "+": "reject", id: uuidSchema, mediaType: text });

export const saveRoutes = [
  {
    method: ApiMethod.Post,
    path: "/api/saves",
    operationId: "storeSave",
    summary: "Stream files from an existing local directory into the selected Save store",
    requestSchema: toTransmittedSchema(saveBodySchema),
    responseSchema: toTransmittedSchema(artifactReferenceSchema),
    handler: ({ query, body }) =>
      Effect.gen(function* () {
        yield* validateApiInput(emptyQuerySchema, yield* readApiQuery(query));
        const input = yield* validateApiInput(saveBodySchema, body);
        yield* requireAbsolutePath(input.directory, "directory");
        const artifact = yield* (yield* DAEMON_ARTIFACT_INPUT).fromDirectory(input.directory);
        return yield* (yield* SAVE_STORE_WORKFLOW).storeSave(artifact, input.preferredAdapterId);
      })
  }
] as const satisfies readonly ApiRoute[];
