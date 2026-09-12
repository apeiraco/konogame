import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  ADAPTER_RESOLUTION_PLANNER,
  ADAPTER_RESOLVER,
  type AdapterResolutionPlanner,
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind,
  type AdapterResolver,
  adapterResolutionPlanSchema,
  FeatureNotFoundError,
  ID_SERVICE,
  type IdService,
  LOCATION_BEHAVIOR,
  type LocationBehaviorService
} from "@konogame/infrastructure";
import { assertSchema } from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import { Context, Effect, Layer } from "effect";
import {
  applyConfigurationEdit,
  type ConfigurationEditChange,
  configurationEditChangeSchema,
  configurationEditDifferenceSchema,
  editConfigurationInputSchema,
  type InitializeConfigurationInput,
  initializeConfigurationInputSchema,
  type RecoverEditConfigurationInput,
  type RecoverImportConfigurationInput,
  type RecoverInitializeConfigurationInput,
  type RenameConfigurationInput,
  recoverEditConfigurationInputSchema,
  recoverImportConfigurationInputSchema,
  recoverInitializeConfigurationInputSchema
} from "../model/edits.ts";
import { WorkspaceNotFoundError, WorkspaceResourceKind } from "../model/errors.ts";
import { uuidSchema } from "../model/records.ts";
import {
  HistoryAvailability,
  HistoryMode,
  WorkspaceFeature,
  WorkspaceOperation
} from "../model/vocabulary.ts";
import {
  configurationHistoryImplementation,
  workspaceConfigurationImplementation
} from "../ports/implementation.ts";
import {
  WorkspaceMismatchKind,
  WorkspaceReviewMismatchError,
  WorkspaceSelectionError,
  WorkspaceSelectionKind,
  workspaceRule
} from "./errors.ts";
import {
  inspectWorkspaceSnapshot,
  type WorkspaceSelection,
  workspaceSettings
} from "./selection.ts";

export {
  WorkspaceMismatchKind,
  WorkspaceReviewMismatchError,
  WorkspaceSelectionError,
  WorkspaceSelectionKind
};

const text = type.string.atLeastLength(1);
export const workspaceEditPreviewSchema = type({
  "+": "reject",
  schemaVersion: type.unit("workspace-edit-preview.1"),
  root: text,
  operationId: uuidSchema,
  workspaceId: uuidSchema,
  expectedRevision: text,
  configurationAdapterId: text,
  change: configurationEditChangeSchema,
  differences: configurationEditDifferenceSchema.array(),
  readAdapterResolutionPlan: adapterResolutionPlanSchema,
  applyAdapterResolutionPlan: adapterResolutionPlanSchema,
  digest: type.string.matching(/^[0-9a-f]{64}$/)
}).onDeepUndeclaredKey("reject");
export type WorkspaceEditPreview = (typeof workspaceEditPreviewSchema)["infer"];

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

export class WorkspaceManagementService {
  constructor(
    private readonly plan: AdapterResolutionPlanner,
    private readonly adapterResolver: AdapterResolver,
    private readonly locations: LocationBehaviorService,
    private readonly ids: IdService
  ) {}

  private configuration(feature: string, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const adapterResolutionPlan = yield* this.plan.plan(
        [feature],
        preferredAdapterId ? { [feature]: preferredAdapterId } : {}
      );
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: feature,
              reason: adapterResolutionPlan.unavailable[0]?.reason
            },
            message: adapterResolutionPlan.unavailable[0]?.reason ?? `No adapter for ${feature}`,
            operation: "configuration"
          })
        );
      }
      const configuration = this.adapterResolver.implementation(
        resolvedAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Implementation,
              featureId: feature,
              adapterId: resolvedAdapter.adapterId,
              operation: resolvedAdapter.operation
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active implementation`,
            operation: "configuration"
          })
        );
      }
      return { configuration, resolvedAdapter, adapterResolutionPlan };
    });
  }

  initialize(input: InitializeConfigurationInput, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const request = yield* workspaceRule(
        "initialize",
        (value: unknown) =>
          assertSchema("workspace.initialize-input", initializeConfigurationInputSchema, value),
        input
      );
      const { configuration, adapterResolutionPlan } = yield* this.configuration(
        WorkspaceFeature.Initialize,
        preferredAdapterId
      );
      if (!configuration.initialize) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.Initialize,
              adapterId: adapterResolutionPlan.resolvedAdapters[0]!.adapterId,
              operation: WorkspaceOperation.Initialize
            },
            message: "Configuration Adapter has no initialize implementation",
            operation: "initialize"
          })
        );
      }
      return { ...(yield* configuration.initialize(request)), adapterResolutionPlan };
    });
  }

  read(root: string, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const { configuration, adapterResolutionPlan } = yield* this.configuration(
        WorkspaceFeature.Inspect,
        preferredAdapterId
      );
      return {
        snapshot: yield* configuration.read({ root: resolve(root) }),
        adapterResolutionPlan
      };
    });
  }

  recoverInitialize(input: RecoverInitializeConfigurationInput, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const request = yield* workspaceRule(
        "recoverInitialize",
        (value: unknown) =>
          assertSchema(
            "workspace.recover-initialize-input",
            recoverInitializeConfigurationInputSchema,
            value
          ),
        input
      );
      const { configuration, adapterResolutionPlan } = yield* this.configuration(
        WorkspaceFeature.RecoverInitialize,
        preferredAdapterId
      );
      if (!configuration.recoverInitialize) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.RecoverInitialize,
              adapterId: adapterResolutionPlan.resolvedAdapters[0]!.adapterId,
              operation: WorkspaceOperation.RecoverInitialize
            },
            message: "Configuration Adapter has no initialize recovery implementation",
            operation: "recoverInitialize"
          })
        );
      }
      return {
        ...(yield* configuration.recoverInitialize(request)),
        adapterResolutionPlan
      };
    });
  }

  preview(input: {
    root: string;
    change: ConfigurationEditChange;
    preferredAdapterId?: string;
    operationId?: string;
  }) {
    return Effect.gen({ self: this }, function* () {
      const change = yield* workspaceRule(
        "preview",
        (value: unknown) =>
          assertSchema("workspace.edit-change", configurationEditChangeSchema, value),
        input.change
      );
      const operationId = yield* workspaceRule(
        "preview",
        (value: unknown) => assertSchema("workspace.uuid", uuidSchema, value),
        input.operationId ?? (yield* this.ids.uuidV7())
      );
      const root = resolve(input.root);
      const { configuration, resolvedAdapter, adapterResolutionPlan } = yield* this.configuration(
        WorkspaceFeature.Inspect,
        input.preferredAdapterId
      );
      const snapshot = yield* configuration.read({ root });
      const edit = yield* workspaceRule(
        "preview",
        (...values: Parameters<typeof applyConfigurationEdit>) => applyConfigurationEdit(...values),
        snapshot,
        change
      );
      const applyAdapterResolutionPlan = yield* this.plan.plan([WorkspaceFeature.Edit], {
        [WorkspaceFeature.Edit]: resolvedAdapter.adapterId
      });
      const body = {
        schemaVersion: "workspace-edit-preview.1" as const,
        root,
        operationId,
        workspaceId: snapshot.workspace.id,
        expectedRevision: snapshot.revision,
        configurationAdapterId: resolvedAdapter.adapterId,
        change,
        differences: edit.differences,
        readAdapterResolutionPlan: adapterResolutionPlan,
        applyAdapterResolutionPlan
      };
      return yield* workspaceRule(
        "preview",
        (value: unknown) =>
          assertSchema("application.workspace-edit-preview", workspaceEditPreviewSchema, value),
        { ...body, digest: digest(body) }
      );
    });
  }

  apply(input: { root: string; preview: unknown }) {
    return Effect.gen({ self: this }, function* () {
      const preview = yield* workspaceRule(
        "apply",
        (value: unknown) =>
          assertSchema("application.workspace-edit-preview", workspaceEditPreviewSchema, value),
        input.preview
      );
      const { digest: expectedDigest, ...body } = preview;
      if (digest(body) !== expectedDigest) {
        return yield* Effect.fail(
          new WorkspaceReviewMismatchError({
            issue: {
              reviewKind: "workspace-edit",
              kind: WorkspaceMismatchKind.Digest,
              expected: expectedDigest,
              actual: digest(body)
            },
            message: "Workspace edit preview digest does not match its content",
            operation: "apply"
          })
        );
      }
      if (resolve(input.root) !== preview.root) {
        return yield* Effect.fail(
          new WorkspaceReviewMismatchError({
            issue: {
              reviewKind: "workspace-edit",
              kind: WorkspaceMismatchKind.Root,
              expected: preview.root,
              actual: resolve(input.root)
            },
            message: "Workspace edit preview root does not match the selected root",
            operation: "apply"
          })
        );
      }
      const current = yield* this.preview({
        root: input.root,
        change: preview.change,
        operationId: preview.operationId,
        preferredAdapterId: preview.configurationAdapterId
      });
      if (current.digest !== preview.digest) {
        return yield* Effect.fail(
          new WorkspaceReviewMismatchError({
            issue: {
              reviewKind: "workspace-edit",
              kind: WorkspaceMismatchKind.Stale,
              expected: preview.digest,
              actual: current.digest,
              expectedRevision: preview.expectedRevision,
              actualRevision: current.expectedRevision
            },
            message: "Workspace edit preview is stale; review a new preview",
            operation: "apply"
          })
        );
      }
      const { configuration, adapterResolutionPlan } = yield* this.configuration(
        WorkspaceFeature.Edit,
        preview.configurationAdapterId
      );
      if (!configuration.edit) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.Edit,
              adapterId: adapterResolutionPlan.resolvedAdapters[0]!.adapterId,
              operation: WorkspaceOperation.Edit
            },
            message: "Configuration Adapter has no edit implementation",
            operation: "apply"
          })
        );
      }
      const request = yield* workspaceRule(
        "apply",
        (value: unknown) =>
          assertSchema("workspace.edit-input", editConfigurationInputSchema, value),
        {
          root: preview.root,
          operationId: preview.operationId,
          expectedRevision: preview.expectedRevision,
          change: preview.change
        }
      );
      return { ...(yield* configuration.edit(request)), adapterResolutionPlan };
    });
  }

  recoverEdit(input: RecoverEditConfigurationInput, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const request = yield* workspaceRule(
        "recoverEdit",
        (value: unknown) =>
          assertSchema("workspace.recover-edit-input", recoverEditConfigurationInputSchema, value),
        input
      );
      const { configuration, adapterResolutionPlan } = yield* this.configuration(
        WorkspaceFeature.RecoverEdit,
        preferredAdapterId
      );
      if (!configuration.recoverEdit) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.RecoverEdit,
              adapterId: adapterResolutionPlan.resolvedAdapters[0]!.adapterId,
              operation: WorkspaceOperation.RecoverEdit
            },
            message: "Configuration Adapter has no edit recovery implementation",
            operation: "recoverEdit"
          })
        );
      }
      return { ...(yield* configuration.recoverEdit(request)), adapterResolutionPlan };
    });
  }

  inspectWorkspace(root: string, selection: WorkspaceSelection = {}) {
    return Effect.gen({ self: this }, function* () {
      // Bootstrap selection cannot depend on the configuration it is about to load.
      const adapterResolutionPlan = yield* this.plan.plan(
        [WorkspaceFeature.Inspect],
        selection.preferredAdapterId === undefined
          ? {}
          : { [WorkspaceFeature.Inspect]: selection.preferredAdapterId }
      );
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: WorkspaceFeature.Inspect,
              reason: adapterResolutionPlan.unavailable[0]?.reason
            },
            message:
              adapterResolutionPlan.unavailable[0]?.reason ??
              "No Workspace configuration adapter available",
            operation: "inspectWorkspace"
          })
        );
      }
      const configuration = this.adapterResolver.implementation(
        resolvedAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Implementation,
              featureId: WorkspaceFeature.Inspect,
              adapterId: resolvedAdapter.adapterId,
              operation: resolvedAdapter.operation
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active implementation`,
            operation: "inspectWorkspace"
          })
        );
      }
      const snapshot = yield* configuration.read({ root });
      const requestedAdapterId =
        snapshot.workspace.history.mode === HistoryMode.Disabled
          ? null
          : snapshot.workspace.history.adapterId;
      const historyPlan =
        requestedAdapterId === null
          ? yield* this.plan.plan([])
          : yield* this.plan.plan([WorkspaceFeature.History], {
              [WorkspaceFeature.History]: requestedAdapterId
            });
      const historyAdapter = historyPlan.resolvedAdapters[0];
      const activeHistory =
        historyAdapter &&
        this.adapterResolver.implementation(historyAdapter, configurationHistoryImplementation);
      return {
        ...(yield* inspectWorkspaceSnapshot(snapshot, selection, this.locations)),
        adapterResolutionPlan,
        history: {
          requestedAdapterId,
          status:
            requestedAdapterId === null
              ? HistoryAvailability.Disabled
              : activeHistory
                ? HistoryAvailability.Available
                : HistoryAvailability.Unavailable,
          adapterResolutionPlan: historyPlan,
          reason:
            historyAdapter && !activeHistory
              ? `Adapter ${historyAdapter.adapterId} has no active implementation`
              : historyPlan.unavailable[0]?.reason
        }
      };
    });
  }

  private readWorkspace(root: string, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const adapterResolutionPlan = yield* this.plan.plan(
        [WorkspaceFeature.Inspect],
        preferredAdapterId === undefined ? {} : { [WorkspaceFeature.Inspect]: preferredAdapterId }
      );
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: WorkspaceFeature.Inspect,
              reason: adapterResolutionPlan.unavailable[0]?.reason
            },
            message: adapterResolutionPlan.unavailable[0]?.reason ?? "Workspace unavailable",
            operation: "readWorkspace"
          })
        );
      }
      const configuration = this.adapterResolver.implementation(
        resolvedAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Implementation,
              featureId: WorkspaceFeature.Inspect,
              adapterId: resolvedAdapter.adapterId,
              operation: resolvedAdapter.operation
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active implementation`,
            operation: "readWorkspace"
          })
        );
      }
      return { snapshot: yield* configuration.read({ root }), adapterResolutionPlan };
    });
  }

  listGames(
    root: string,
    selection: {
      hostId?: string;
      sourceId?: string;
      preferredAdapterId?: string;
    } = {}
  ) {
    return Effect.gen({ self: this }, function* () {
      const { snapshot, adapterResolutionPlan } = yield* this.readWorkspace(
        root,
        selection.preferredAdapterId
      );
      if (selection.hostId && !snapshot.hosts.some((host) => host.id === selection.hostId)) {
        return yield* Effect.fail(
          new WorkspaceNotFoundError({
            resource: WorkspaceResourceKind.Host,
            id: selection.hostId,
            message: `Unknown host: ${selection.hostId}`
          })
        );
      }
      if (selection.sourceId && !selection.hostId) {
        return yield* Effect.fail(
          new WorkspaceSelectionError({
            issue: { kind: WorkspaceSelectionKind.HostRequired, sourceId: selection.sourceId },
            message: "Select a Host when filtering by source",
            operation: "listGames"
          })
        );
      }
      const games = yield* Effect.all(
        snapshot.games.map((game) =>
          Effect.gen({ self: this }, function* () {
            const installations = yield* Effect.all(
              snapshot.installations
                .filter(
                  (item) =>
                    item.gameId === game.id &&
                    (!selection.hostId || item.hostId === selection.hostId) &&
                    (!selection.sourceId || item.sourceId === selection.sourceId)
                )
                .map((installation) =>
                  Effect.gen({ self: this }, function* () {
                    const host = snapshot.hosts.find((item) => item.id === installation.hostId)!;
                    return {
                      ...installation,
                      host: {
                        id: host.id,
                        uniformName: host.uniformName,
                        label: host.label,
                        platform: host.platform
                      },
                      source: host.sources.find((source) => source.id === installation.sourceId),
                      locationStatus: yield* this.locations.inspect(installation.location, {
                        platform: host.platform,
                        roots: host.roots
                      })
                    };
                  })
                )
            );
            return { ...game, installations };
          })
        )
      );
      return {
        workspace: { id: snapshot.workspace.id, name: snapshot.workspace.name },
        revision: snapshot.revision,
        diagnostics: snapshot.diagnostics ?? [],
        games:
          selection.hostId || selection.sourceId
            ? games.filter((game) => game.installations.length)
            : games,
        adapterResolutionPlan
      };
    });
  }

  showGame(root: string, gameId: string, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const result = yield* this.listGames(root, { preferredAdapterId });
      const game = result.games.find((item) => item.id === gameId);
      if (!game) {
        return yield* Effect.fail(
          new WorkspaceNotFoundError({
            resource: WorkspaceResourceKind.Game,
            id: gameId,
            message: `Unknown game: ${gameId}`
          })
        );
      }
      return {
        workspace: result.workspace,
        revision: result.revision,
        diagnostics: result.diagnostics,
        game,
        adapterResolutionPlan: result.adapterResolutionPlan
      };
    });
  }

  explainSettings(
    root: string,
    selection: WorkspaceSelection = {},
    featureIds?: readonly string[]
  ) {
    return Effect.gen({ self: this }, function* () {
      const { snapshot, adapterResolutionPlan } = yield* this.readWorkspace(
        root,
        selection.preferredAdapterId
      );
      const inferredHostId =
        selection.hostId ??
        snapshot.installations.find((item) => item.id === selection.installationId)?.hostId;
      const { host, installation, game, layers, effective } = yield* workspaceRule(
        "explainSettings",
        (...values: Parameters<typeof workspaceSettings>) => workspaceSettings(...values),
        snapshot,
        {
          ...selection,
          hostId: inferredHostId
        }
      );
      const preferences = Object.fromEntries(
        Object.entries(effective.values.preferredAdapters ?? {}).filter(
          (entry): entry is [string, string] => entry[1] !== null
        )
      );
      const requested = featureIds ?? Object.keys(effective.values.preferredAdapters ?? {});
      const plans = yield* Effect.all(
        requested.map((featureId) =>
          Effect.gen({ self: this }, function* () {
            return yield* Effect.gen({ self: this }, function* () {
              const feature = this.adapterResolver.features().find((item) => item.id === featureId);
              if (!feature) {
                return yield* Effect.fail(
                  new FeatureNotFoundError({
                    issue: { kind: "feature", id: featureId },
                    message: `Unknown feature: ${featureId}`,
                    operation: "explainSettings"
                  })
                );
              }
              return {
                featureId,
                adapterResolutionPlan: yield* this.adapterResolver.resolve([
                  {
                    feature,
                    preferredAdapterId: preferences[featureId]
                  }
                ])
              };
            }).pipe(
              Effect.catchTag("FeatureNotFoundError", (error) =>
                Effect.succeed({ featureId, reason: error.message })
              )
            );
          })
        )
      );
      return {
        workspace: { id: snapshot.workspace.id, name: snapshot.workspace.name },
        revision: snapshot.revision,
        selection: {
          hostId: host?.id,
          gameId: game?.id,
          installationId: installation?.id
        },
        layers,
        effective,
        features: plans,
        ...(installation
          ? {
              locationStatus: yield* this.locations.inspect(installation.location, {
                platform: host!.platform,
                roots: host!.roots
              })
            }
          : {}),
        adapterResolutionPlan
      };
    });
  }

  renameWorkspace(input: RenameConfigurationInput, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const adapterResolutionPlan = yield* this.plan.plan(
        [WorkspaceFeature.Rename],
        preferredAdapterId === undefined ? {} : { [WorkspaceFeature.Rename]: preferredAdapterId }
      );
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: WorkspaceFeature.Rename,
              reason: adapterResolutionPlan.unavailable[0]?.reason
            },
            message:
              adapterResolutionPlan.unavailable[0]?.reason ??
              "No Workspace rename adapter available",
            operation: "renameWorkspace"
          })
        );
      }
      const configuration = this.adapterResolver.implementation(
        resolvedAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration?.rename) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.Rename,
              adapterId: resolvedAdapter.adapterId,
              operation: WorkspaceOperation.Rename
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active rename implementation`,
            operation: "renameWorkspace"
          })
        );
      }
      const result = yield* configuration.rename(input);
      return { ...result, adapterResolutionPlan };
    });
  }

  recoverWorkspaceImport(input: RecoverImportConfigurationInput, preferredAdapterId?: string) {
    return Effect.gen({ self: this }, function* () {
      const request = yield* workspaceRule(
        "recoverWorkspaceImport",
        (value: unknown) =>
          assertSchema(
            "workspace.recover-import-input",
            recoverImportConfigurationInputSchema,
            value
          ),
        input
      );
      const adapterResolutionPlan = yield* this.plan.plan(
        [WorkspaceFeature.RecoverImport],
        preferredAdapterId === undefined
          ? {}
          : { [WorkspaceFeature.RecoverImport]: preferredAdapterId }
      );
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      if (!resolvedAdapter) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: WorkspaceFeature.RecoverImport,
              reason: adapterResolutionPlan.unavailable[0]?.reason
            },
            message:
              adapterResolutionPlan.unavailable[0]?.reason ??
              "No Workspace import recovery adapter available",
            operation: "recoverWorkspaceImport"
          })
        );
      }
      const configuration = this.adapterResolver.implementation(
        resolvedAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration?.recoverImport) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.RecoverImport,
              adapterId: resolvedAdapter.adapterId,
              operation: WorkspaceOperation.RecoverImport
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active import recovery implementation`,
            operation: "recoverWorkspaceImport"
          })
        );
      }
      return { ...(yield* configuration.recoverImport(request)), adapterResolutionPlan };
    });
  }
}

export class WORKSPACE_MANAGEMENT extends Context.Service<
  WORKSPACE_MANAGEMENT,
  WorkspaceManagementService
>()("workspace.management") {}

export function provideWorkspaceManagement() {
  return Layer.effect(
    WORKSPACE_MANAGEMENT,
    Effect.gen(function* () {
      return new WorkspaceManagementService(
        yield* ADAPTER_RESOLUTION_PLANNER,
        yield* ADAPTER_RESOLVER,
        yield* LOCATION_BEHAVIOR,
        yield* ID_SERVICE
      );
    })
  );
}
