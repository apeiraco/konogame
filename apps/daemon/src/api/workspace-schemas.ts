import { adapterResolutionPlanSchema } from "@konogame/infrastructure";
import {
  configurationValueSchema,
  LocationResolutionStatus,
  LocationValidationStatus,
  locationContractSchema,
  toTransmittedSchema
} from "@konogame/infrastructure/contracts";
import {
  ConfigurationEditKind,
  EditStatus,
  HistoryAvailability,
  hostSchema,
  ImportStatus,
  InitializeStatus,
  RecordKind,
  RenameStatus,
  SettingsTargetKind,
  settingsSchema,
  text,
  uuidSchema
} from "@konogame/workspace/contracts";
import { workspaceEditPreviewSchema } from "@konogame/workspace/management";
import { type } from "arktype";

export const workspaceSelectionSchema = type({
  "+": "reject",
  "hostId?": uuidSchema,
  "gameId?": uuidSchema,
  "installationId?": uuidSchema,
  "overrides?": settingsSchema,
  "preferredAdapterId?": text
});

export const locationStatusSchema = type({
  "+": "reject",
  validation: {
    "+": "reject",
    status: type.enumerated(...Object.values(LocationValidationStatus)),
    "reason?": text
  },
  availability: type.or(
    type({
      "+": "reject",
      status: type.string.matching(new RegExp(`^${LocationResolutionStatus.Resolved}$`)),
      resource: {
        "+": "reject",
        type: text,
        schemaVersion: text,
        data: configurationValueSchema
      }
    }),
    type({
      "+": "reject",
      status: type.string.matching(new RegExp(`^${LocationResolutionStatus.Unavailable}$`)),
      reason: text
    })
  ),
  adapterResolutionPlan: adapterResolutionPlanSchema
});

const effectiveProjectionSchema = type({
  "+": "reject",
  values: {
    "+": "reject",
    "launchEntry?": "string | null",
    "arguments?": "string[]",
    "preferredAdapters?": { "[string]": "string | null" },
    "adapterOptions?": type({
      "[string]": type({ "[string]": configurationValueSchema })
    })
  },
  origins: { "[string]": "string" }
});
const effectiveSchema = type.merge(effectiveProjectionSchema, {
  values: type.merge(effectiveProjectionSchema.get("values"), {
    "adapterOptions?": type({
      "[string]": type({ "[string]": configurationValueSchema }).or(type.null)
    })
  })
});

const selectedIdsSchema = type({
  "+": "reject",
  "hostId?": uuidSchema,
  "gameId?": uuidSchema,
  "installationId?": uuidSchema
});
const layersSchema = type({ "+": "reject", name: text, settings: settingsSchema }).array();
const workspaceSummarySchema = type({ "+": "reject", id: uuidSchema, name: text });
const diagnosticsSchema = type({ "+": "reject", path: text, message: text }).array();

export const workspaceInspectResponseSchema = type({
  "+": "reject",
  workspace: workspaceSummarySchema,
  revision: text,
  diagnostics: diagnosticsSchema,
  counts: {
    "+": "reject",
    games: "number >= 0",
    hosts: "number >= 0",
    installations: "number >= 0"
  },
  hosts: hostSchema.pick("id", "uniformName", "label", "platform", "roots", "sources").array(),
  games: type({ "+": "reject", id: uuidSchema, uniformName: text, title: text }).array(),
  installations: type({
    "+": "reject",
    id: uuidSchema,
    uniformName: text,
    gameId: uuidSchema,
    hostId: uuidSchema,
    sourceId: text,
    location: locationContractSchema,
    locationStatus: locationStatusSchema
  }).array(),
  selection: selectedIdsSchema,
  effective: effectiveSchema,
  layers: layersSchema,
  adapterResolutionPlan: adapterResolutionPlanSchema,
  history: {
    "+": "reject",
    requestedAdapterId: "string | null",
    status: type.enumerated(...Object.values(HistoryAvailability)),
    adapterResolutionPlan: adapterResolutionPlanSchema,
    "reason?": text
  }
});

export const settingsExplanationResponseSchema = type({
  "+": "reject",
  workspace: workspaceSummarySchema,
  revision: text,
  selection: selectedIdsSchema,
  layers: layersSchema,
  effective: effectiveSchema,
  features: type
    .or(
      type({ "+": "reject", featureId: text, adapterResolutionPlan: adapterResolutionPlanSchema }),
      type({ "+": "reject", featureId: text, reason: text })
    )
    .array(),
  "locationStatus?": locationStatusSchema,
  adapterResolutionPlan: adapterResolutionPlanSchema
});

const writeResultFields = {
  "+": "reject" as const,
  operationId: uuidSchema,
  "revision?": text,
  "reason?": text,
  adapterResolutionPlan: adapterResolutionPlanSchema
};

export const initializeResponseSchema = type({
  ...writeResultFields,
  status: type.enumerated(...Object.values(InitializeStatus)),
  "workspaceId?": uuidSchema,
  "hostId?": uuidSchema
});
export const editResponseSchema = type({
  ...writeResultFields,
  status: type.enumerated(...Object.values(EditStatus)),
  "recordId?": uuidSchema
});
export const renameResponseSchema = type({
  ...writeResultFields,
  status: type.enumerated(...Object.values(RenameStatus)),
  "paths?": type({ "+": "reject", from: text, to: text }).array()
});
export const importRecoveryResponseSchema = type({
  ...writeResultFields,
  status: type.enumerated(...Object.values(ImportStatus)),
  "gameIds?": uuidSchema.array(),
  "installationIds?": uuidSchema.array()
});

// ArkType cannot transmit a nullable object map containing the recursive configuration
// value. Restore that one JSON Schema union after transmitting the complete graph.
export function settingsResponseJsonSchema(
  schema: typeof workspaceInspectResponseSchema | typeof settingsExplanationResponseSchema
): object {
  const document = toTransmittedSchema(
    type.merge(schema, { effective: effectiveProjectionSchema })
  ) as unknown as Record<string, unknown>;
  function dereference(value: unknown): Record<string, unknown> {
    const node = value as Record<string, unknown>;
    return typeof node.$ref === "string"
      ? dereference(
          node.$ref
            .slice(2)
            .split("/")
            .reduce<unknown>((item, key) => (item as Record<string, unknown>)[key], document)
        )
      : node;
  }
  const root = dereference(document);
  const effective = dereference((root.properties as Record<string, unknown>).effective);
  const values = dereference((effective.properties as Record<string, unknown>).values);
  const options = dereference((values.properties as Record<string, unknown>).adapterOptions);
  options.additionalProperties = { anyOf: [options.additionalProperties, { type: "null" }] };
  return document;
}

const literal = (value: string) => type.string.matching(new RegExp(`^${RegExp.escape(value)}$`));
const targetSchema = (kind: string) =>
  type({ "+": "reject", kind: literal(kind), recordId: uuidSchema });

// The owner still validates every request. These equivalent portable projections avoid
// ArkType's deep-undeclared-key conversion failure on recursive configuration values.
export const editChangeProjectionSchema = type.or(
  type({
    "+": "reject",
    kind: literal(ConfigurationEditKind.MetadataReplace),
    target: targetSchema(RecordKind.Workspace),
    metadata: { "+": "reject", name: text }
  }),
  type({
    "+": "reject",
    kind: literal(ConfigurationEditKind.MetadataReplace),
    target: targetSchema(RecordKind.Game),
    metadata: { "+": "reject", title: text, "edition?": text }
  }),
  type({
    "+": "reject",
    kind: literal(ConfigurationEditKind.MetadataReplace),
    target: targetSchema(RecordKind.Host),
    metadata: { "+": "reject", label: text }
  }),
  type({
    "+": "reject",
    kind: literal(ConfigurationEditKind.SettingsReplace),
    target: type.or(
      type({
        "+": "reject",
        kind: type.enumerated(
          SettingsTargetKind.Workspace,
          SettingsTargetKind.Game,
          SettingsTargetKind.Host,
          SettingsTargetKind.Installation
        ),
        recordId: uuidSchema
      }),
      type({
        "+": "reject",
        kind: literal(SettingsTargetKind.HostGame),
        recordId: uuidSchema,
        gameId: uuidSchema
      })
    ),
    settings: settingsSchema
  }),
  type({ "+": "reject", kind: literal(ConfigurationEditKind.HostCreate), host: hostSchema }),
  type({
    "+": "reject",
    kind: literal(ConfigurationEditKind.HostRootsReplace),
    hostId: uuidSchema,
    roots: hostSchema.get("roots")
  }),
  type({
    "+": "reject",
    kind: literal(ConfigurationEditKind.HostSourcesReplace),
    hostId: uuidSchema,
    sources: hostSchema.get("sources")
  })
);
export const editPreviewProjectionSchema = type({
  "+": "reject",
  schemaVersion: workspaceEditPreviewSchema.get("schemaVersion"),
  root: text,
  operationId: uuidSchema,
  workspaceId: uuidSchema,
  expectedRevision: text,
  configurationAdapterId: text,
  change: editChangeProjectionSchema,
  differences: type({
    "+": "reject",
    field: text,
    "before?": configurationValueSchema,
    "after?": configurationValueSchema
  }).array(),
  readAdapterResolutionPlan: adapterResolutionPlanSchema,
  applyAdapterResolutionPlan: adapterResolutionPlanSchema,
  digest: type.string.matching(/^[0-9a-f]{64}$/)
});
