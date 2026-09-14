import {
  admissionCandidateSchema,
  DiscoveryDisposition,
  GAME_DISCOVERY_PREVIEW_SCHEMA,
  gameDiscoveryPreviewSchema
} from "@konogame/game/admission";
import { discoverySourceKindSchema, GamePort } from "@konogame/game/contracts";
import { adapterResolutionPlanSchema } from "@konogame/infrastructure";
import {
  configurationValueSchema,
  LocationValidationStatus,
  locationContractSchema
} from "@konogame/infrastructure/contracts";
import {
  ExternalIdentityPurpose,
  gameSchema,
  hostSchema,
  installationSchema,
  SourceStatus,
  text,
  token,
  uuidSchema
} from "@konogame/workspace/contracts";
import { type } from "arktype";
import { locationStatusSchema } from "./workspace-schemas.ts";

export const gameListQuerySchema = type({
  "+": "reject",
  root: text,
  "hostId?": uuidSchema,
  "sourceId?": text,
  "preferredAdapterId?": text
});
export const gameShowQuerySchema = type({
  "+": "reject",
  root: text,
  "preferredAdapterId?": text
});
export const gamePathSchema = type({ "+": "reject", gameId: uuidSchema });
export const emptyQuerySchema = type({ "+": "reject" });

const installationViewSchema = type.merge(installationSchema, {
  host: hostSchema.pick("id", "uniformName", "label", "platform"),
  "source?": type({
    "+": "reject",
    id: token,
    kind: token,
    status: type.enumerated(...Object.values(SourceStatus))
  }),
  locationStatus: locationStatusSchema
});
const gameViewSchema = type.merge(gameSchema, { installations: installationViewSchema.array() });
const libraryEnvelope = {
  "+": "reject" as const,
  workspace: { "+": "reject" as const, id: uuidSchema, name: text },
  revision: text,
  diagnostics: type({ "+": "reject", path: text, message: text }).array(),
  adapterResolutionPlan: adapterResolutionPlanSchema
};
export const gameListResponseSchema = type({ ...libraryEnvelope, games: gameViewSchema.array() });
export const gameShowResponseSchema = type({ ...libraryEnvelope, game: gameViewSchema });

// Discovery's executable predicates remain in the owner validator. This projection keeps
// the portable structure explicit because ArkType cannot transmit their intersections.
const discoveryRefSchema = type({
  "+": "reject",
  authority: token,
  kind: token,
  key: type({ "+": "reject", "[/.+/]": text }).describe(
    "At least one external reference key is required"
  )
});
const candidateSchema = type({
  "+": "reject",
  observationKey: text,
  title: text,
  location: locationContractSchema,
  externalRefs: discoveryRefSchema.array(),
  "externalIdentities?": type({
    "+": "reject",
    issuer: token,
    purpose: type.enumerated(...Object.values(ExternalIdentityPurpose)),
    value: text
  }).array(),
  evidence: type({ "+": "reject", kind: text, path: text, fingerprint: text })
    .array()
    .atLeastLength(1),
  candidateId: uuidSchema,
  provenance: {
    "+": "reject",
    adapterId: text,
    port: type.string.matching(new RegExp(`^${GamePort.Discovery.replaceAll(".", "\\.")}$`)),
    hostId: uuidSchema,
    sourceId: text
  },
  "conflict?": {
    "+": "reject",
    kind: admissionCandidateSchema.get("conflict").exclude("undefined").get("kind"),
    "recordIds?": text.array(),
    "issuer?": text
  },
  disposition: type.enumerated(...Object.values(DiscoveryDisposition)),
  locationValidation: {
    "+": "reject",
    status: type.enumerated(...Object.values(LocationValidationStatus)),
    "reason?": text
  },
  "existingGameId?": uuidSchema,
  "existingInstallationId?": uuidSchema,
  "reason?": text
});
export const discoveryPreviewProjectionSchema = type({
  "+": "reject",
  schemaVersion: type.string.matching(
    new RegExp(`^${GAME_DISCOVERY_PREVIEW_SCHEMA.replaceAll(".", "\\.")}$`)
  ),
  operationId: uuidSchema,
  createdAt: gameDiscoveryPreviewSchema.get("createdAt"),
  root: text,
  workspaceId: uuidSchema,
  revision: text,
  hostId: uuidSchema,
  sourceId: text,
  sourceKind: discoverySourceKindSchema,
  scope: type({ "[string]": configurationValueSchema }).describe(
    "Adapter-owned scope object, limited to 262144 JSON characters"
  ),
  discoveryAdapterId: text,
  configurationAdapterId: text,
  candidates: candidateSchema.array(),
  diagnostics: type({ "+": "reject", code: text, message: text, "path?": text }).array(),
  adapterResolutionPlan: adapterResolutionPlanSchema,
  digest: type.string.matching(/^[0-9a-f]{64}$/)
});

export const discoveryInputProjectionSchema = type({
  "+": "reject",
  root: text,
  hostId: uuidSchema,
  sourceId: text,
  scope: type({ "[string]": configurationValueSchema }).describe(
    "Adapter-owned scope object, limited to 262144 JSON characters"
  ),
  "preferredAdapterId?": text,
  "configurationAdapterId?": text
});

export const gameAdmissionBodySchema = type({
  "+": "reject",
  root: text,
  preview: "unknown",
  selectedCandidateIds: uuidSchema
    .array()
    .atLeastLength(1)
    .describe("Distinct candidate UUIDs selected from the supplied preview"),
  confirmed: "true",
  "operationId?": uuidSchema,
  "hostId?": uuidSchema,
  "sourceId?": text
});
export const gameAdmissionProjectionSchema = type.merge(gameAdmissionBodySchema, {
  preview: discoveryPreviewProjectionSchema
});
