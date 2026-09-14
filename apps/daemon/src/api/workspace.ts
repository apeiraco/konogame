import { isAbsolute } from "node:path";
import { toTransmittedSchema } from "@konogame/infrastructure/contracts";
import {
  ConfigurationEditKind,
  configurationEditChangeSchema,
  EditStatus,
  hostSchema,
  ImportStatus,
  InitializeStatus,
  RenameStatus,
  text,
  uuidSchema,
  workspaceJsonSchema,
  workspaceSchema
} from "@konogame/workspace/contracts";
import { WORKSPACE_MANAGEMENT, workspaceEditPreviewSchema } from "@konogame/workspace/management";
import { type } from "arktype";
import { Effect } from "effect";
import { readApiQuery, validateApiInput } from "./request-input.ts";
import { ApiError, ApiMethod, type ApiRoute, ApiStatus } from "./route.ts";
import {
  editChangeProjectionSchema,
  editPreviewProjectionSchema,
  editResponseSchema,
  importRecoveryResponseSchema,
  initializeResponseSchema,
  renameResponseSchema,
  settingsExplanationResponseSchema,
  settingsResponseJsonSchema,
  workspaceInspectResponseSchema,
  workspaceSelectionSchema
} from "./workspace-schemas.ts";

const root = text
  .narrow((value, ctx) => isAbsolute(value) || ctx.mustBe("an absolute Workspace root"))
  .describe("Absolute Workspace root on the daemon host platform");
const emptyQuery = type({ "+": "reject" });
const inspectRequest = type({
  "+": "reject",
  root,
  "hostId?": uuidSchema,
  "gameId?": uuidSchema,
  "installationId?": uuidSchema,
  "preferredAdapterId?": text
});
const explainRequest = type({
  "+": "reject",
  root,
  "selection?": workspaceSelectionSchema,
  "featureIds?": text.array()
});
const initializeRequest = type({
  "+": "reject",
  root,
  operationId: uuidSchema,
  workspace: workspaceSchema,
  host: hostSchema,
  confirmed: type.unit(true),
  "preferredAdapterId?": text
});
const previewRequest = type({
  "+": "reject",
  root,
  change: configurationEditChangeSchema,
  "preferredAdapterId?": text,
  "operationId?": uuidSchema
}).onDeepUndeclaredKey("reject");
const hostPreviewRequest = type({
  "+": "reject",
  root,
  host: hostSchema,
  "preferredAdapterId?": text,
  "operationId?": uuidSchema
}).onDeepUndeclaredKey("reject");
const applyRequest = type({
  "+": "reject",
  root,
  confirmed: type.unit(true),
  preview: workspaceEditPreviewSchema
}).onDeepUndeclaredKey("reject");
const hostApplyProjectionSchema = type.merge(applyRequest, {
  preview: type.merge(editPreviewProjectionSchema, {
    change: type({
      "+": "reject",
      kind: type.string.matching(
        new RegExp(`^${RegExp.escape(ConfigurationEditKind.HostCreate)}$`)
      ),
      host: hostSchema
    })
  })
});
const renameRequest = type({
  "+": "reject",
  root,
  recordId: uuidSchema,
  uniformName: text,
  expectedRevision: text,
  operationId: uuidSchema,
  confirmed: type.unit(true),
  "preferredAdapterId?": text
});
const recoveryRequest = type({
  "+": "reject",
  root,
  operationId: uuidSchema,
  confirmed: type.unit(true),
  "preferredAdapterId?": text
});

const initializeStatusCodes = {
  [InitializeStatus.Conflict]: ApiStatus.Conflict,
  [InitializeStatus.RecoveryRequired]: ApiStatus.Conflict,
  [InitializeStatus.Failed]: ApiStatus.Unprocessable
};
const editStatusCodes = {
  [EditStatus.Conflict]: ApiStatus.Conflict,
  [EditStatus.RecoveryRequired]: ApiStatus.Conflict,
  [EditStatus.Failed]: ApiStatus.Unprocessable
};
const renameStatusCodes = {
  [RenameStatus.Conflict]: ApiStatus.Conflict,
  [RenameStatus.RecoveryRequired]: ApiStatus.Conflict,
  [RenameStatus.Failed]: ApiStatus.Unprocessable
};
const importStatusCodes = {
  [ImportStatus.Conflict]: ApiStatus.Conflict,
  [ImportStatus.RecoveryRequired]: ApiStatus.Conflict,
  [ImportStatus.Failed]: ApiStatus.Unprocessable
};

const routes: readonly ApiRoute[] = [
  {
    method: ApiMethod.Get,
    path: "/api/workspace/schema",
    operationId: "workspaceSchema",
    summary: "Export the owner Workspace record JSON Schema",
    responseSchema: {
      type: "object",
      description: "The Workspace record JSON Schema with locally resolvable definitions.",
      required: ["$schema", "$ref", "$defs"],
      properties: {
        $schema: { const: "https://json-schema.org/draft/2020-12/schema" },
        $ref: { type: "string" },
        $defs: { type: "object", additionalProperties: { type: ["object", "boolean"] } }
      }
    },
    handler: () => Effect.sync(workspaceJsonSchema)
  },
  {
    method: ApiMethod.Get,
    path: "/api/workspace/inspect",
    operationId: "workspaceInspect",
    summary: "Inspect Workspace records, selections, settings and Location availability",
    queryParameters: [
      { name: "root", required: true, schema: toTransmittedSchema(root) },
      { name: "hostId", schema: toTransmittedSchema(uuidSchema) },
      { name: "gameId", schema: toTransmittedSchema(uuidSchema) },
      { name: "installationId", schema: toTransmittedSchema(uuidSchema) },
      { name: "preferredAdapterId", schema: toTransmittedSchema(text) }
    ],
    responseSchema: settingsResponseJsonSchema(workspaceInspectResponseSchema),
    handler: ({ query }) =>
      Effect.gen(function* () {
        const { root, ...selection } = yield* validateApiInput(
          inspectRequest,
          yield* readApiQuery(query)
        );
        return yield* (yield* WORKSPACE_MANAGEMENT).inspectWorkspace(root, selection);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/explain",
    operationId: "workspaceExplainSettings",
    summary: "Explain persistent and invocation settings with Adapter resolution",
    requestSchema: toTransmittedSchema(explainRequest),
    responseSchema: settingsResponseJsonSchema(settingsExplanationResponseSchema),
    handler: ({ body }) =>
      Effect.gen(function* () {
        const input = yield* validateApiInput(explainRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).explainSettings(
          input.root,
          input.selection,
          input.featureIds
        );
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/initialize",
    operationId: "workspaceInitialize",
    summary:
      "Initialize a selected existing root with explicit confirmation and operation identity",
    requestSchema: toTransmittedSchema(initializeRequest),
    responseSchema: toTransmittedSchema(initializeResponseSchema),
    resultStatusCodes: initializeStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const {
          confirmed: _confirmed,
          preferredAdapterId,
          ...input
        } = yield* validateApiInput(initializeRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).initialize(input, preferredAdapterId);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/hosts/preview",
    operationId: "workspacePreviewHostCreation",
    summary: "Review a new Host record without writing configuration",
    requestSchema: toTransmittedSchema(type.merge(hostPreviewRequest, { host: hostSchema })),
    responseSchema: toTransmittedSchema(editPreviewProjectionSchema),
    handler: ({ body }) =>
      Effect.gen(function* () {
        const { host, ...input } = yield* validateApiInput(hostPreviewRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).preview({
          ...input,
          change: { kind: ConfigurationEditKind.HostCreate, host }
        });
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/hosts",
    operationId: "workspaceCreateHost",
    summary:
      "Apply a reviewed Host creation with explicit confirmation and independent root anchoring",
    requestSchema: toTransmittedSchema(hostApplyProjectionSchema),
    responseSchema: toTransmittedSchema(editResponseSchema),
    resultStatusCodes: editStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const input = yield* validateApiInput(applyRequest, body);
        if (input.preview.change.kind !== ConfigurationEditKind.HostCreate) {
          return yield* Effect.fail(
            ApiError.badRequest("Host creation requires a host.create preview")
          );
        }
        return yield* (yield* WORKSPACE_MANAGEMENT).apply({
          root: input.root,
          preview: input.preview
        });
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/edit/preview",
    operationId: "workspacePreviewEdit",
    summary: "Review one strict configuration edit and its read/apply Adapter plans without writes",
    requestSchema: toTransmittedSchema(
      type.merge(previewRequest, { change: editChangeProjectionSchema })
    ),
    responseSchema: toTransmittedSchema(editPreviewProjectionSchema),
    handler: ({ body }) =>
      Effect.gen(function* () {
        return yield* (yield* WORKSPACE_MANAGEMENT).preview(
          yield* validateApiInput(previewRequest, body)
        );
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/edit/apply",
    operationId: "workspaceApplyEdit",
    summary:
      "Apply a fresh reviewed edit with confirmation, revision checks and independent root anchoring",
    requestSchema: toTransmittedSchema(
      type.merge(applyRequest, { preview: editPreviewProjectionSchema })
    ),
    responseSchema: toTransmittedSchema(editResponseSchema),
    resultStatusCodes: editStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const input = yield* validateApiInput(applyRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).apply({
          root: input.root,
          preview: input.preview
        });
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/rename",
    operationId: "workspaceRename",
    summary:
      "Rename a UUID record while preserving references with a caller-supplied revision and confirmation",
    requestSchema: toTransmittedSchema(renameRequest),
    responseSchema: toTransmittedSchema(renameResponseSchema),
    resultStatusCodes: renameStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const {
          confirmed: _confirmed,
          preferredAdapterId,
          ...input
        } = yield* validateApiInput(renameRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).renameWorkspace(input, preferredAdapterId);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/recover-initialize",
    operationId: "workspaceRecoverInitialize",
    summary: "Recover only the selected initialization journal with explicit confirmation",
    requestSchema: toTransmittedSchema(recoveryRequest),
    responseSchema: toTransmittedSchema(initializeResponseSchema),
    resultStatusCodes: initializeStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const {
          confirmed: _confirmed,
          preferredAdapterId,
          ...input
        } = yield* validateApiInput(recoveryRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).recoverInitialize(input, preferredAdapterId);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/recover-edit",
    operationId: "workspaceRecoverEdit",
    summary: "Recover only the selected approved edit journal with explicit confirmation",
    requestSchema: toTransmittedSchema(recoveryRequest),
    responseSchema: toTransmittedSchema(editResponseSchema),
    resultStatusCodes: editStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const {
          confirmed: _confirmed,
          preferredAdapterId,
          ...input
        } = yield* validateApiInput(recoveryRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).recoverEdit(input, preferredAdapterId);
      })
  },
  {
    method: ApiMethod.Post,
    path: "/api/workspace/recover-import",
    operationId: "workspaceRecoverImport",
    summary: "Recover only selected approved import metadata without executing Location resources",
    requestSchema: toTransmittedSchema(recoveryRequest),
    responseSchema: toTransmittedSchema(importRecoveryResponseSchema),
    resultStatusCodes: importStatusCodes,
    handler: ({ body }) =>
      Effect.gen(function* () {
        const {
          confirmed: _confirmed,
          preferredAdapterId,
          ...input
        } = yield* validateApiInput(recoveryRequest, body);
        return yield* (yield* WORKSPACE_MANAGEMENT).recoverWorkspaceImport(
          input,
          preferredAdapterId
        );
      })
  }
];

export const workspaceRoutes: readonly ApiRoute[] = routes.map((route) => ({
  ...route,
  handler: (request) =>
    Effect.gen(function* () {
      if (route.method === ApiMethod.Post || route.path === "/api/workspace/schema") {
        yield* validateApiInput(emptyQuery, yield* readApiQuery(request.query));
      }
      return yield* route.handler(request);
    })
}));
