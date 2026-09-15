import { createHash } from "node:crypto";
import {
  ADAPTER_RESOLUTION_PLANNER,
  ADAPTER_RESOLVER,
  type AdapterResolutionPlanner,
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind,
  type AdapterResolver,
  adapterResolutionPlanSchema,
  ID_SERVICE,
  type IdService,
  LOCATION_BEHAVIOR,
  type LocationBehaviorService,
  TEMPORAL_SERVICE,
  type TemporalService
} from "@konogame/infrastructure";
import {
  type AdapterResolutionPlan,
  assertSchema,
  LocationComparisonStatus,
  type LocationContext,
  LocationOperation,
  LocationValidationStatus
} from "@konogame/infrastructure/contracts";
import {
  type ExternalIdentity,
  ExternalIdentityPurpose,
  type GameRecord,
  gameSchema,
  ImportStatus,
  type InstallationRecord,
  installationSchema,
  RecordKind,
  SourceStatus,
  uuidSchema,
  validateRelationships,
  WORKSPACE_SCHEMA,
  WorkspaceFeature,
  WorkspaceNotFoundError,
  WorkspaceOperation,
  WorkspaceResourceKind,
  type WorkspaceSnapshot,
  workspaceConfigurationImplementation
} from "@konogame/workspace";
import { type } from "arktype";
import { Context, Effect, Layer } from "effect";
import {
  DiscoveryDisposition,
  type DiscoveryObservation,
  discoveryDiagnosticSchema,
  discoveryObservationSchema,
  discoveryScopeSchema,
  discoverySourceCapability,
  discoverySourceKindSchema,
  GameFeature,
  GameOperation,
  GamePort,
  gameDiscoveryResultSchema
} from "../discovery/contract.ts";
import { gameDiscoveryImplementation } from "../discovery/implementation.ts";
import {
  AdmissionConflictKind,
  admissionRule,
  GameDiscoveryConflictError,
  GameDiscoveryConflictKind,
  GameDiscoveryInputError,
  GameDiscoveryInputKind,
  GameDiscoveryMismatchKind,
  GameDiscoveryNotFoundError,
  GameDiscoveryReviewMismatchError,
  GameDiscoveryUnavailableError,
  GameDiscoveryUnavailableKind
} from "./errors.ts";

export { DiscoveryDisposition } from "../discovery/contract.ts";
export {
  GameDiscoveryConflictError,
  GameDiscoveryConflictKind,
  GameDiscoveryInputError,
  GameDiscoveryInputKind,
  GameDiscoveryMismatchKind,
  GameDiscoveryNotFoundError,
  GameDiscoveryReviewMismatchError
};
export const GAME_DISCOVERY_PREVIEW_SCHEMA = "game-discovery-preview.3";
const text = type.string.atLeastLength(1);
// Temporal instants are Zulu ISO strings with optional fractional seconds. Keep that string.
const isoInstant = type.string.matching(
  /^(?:(?:\d\d[2468][048]|\d\d[13579][26]|\d\d0[48]|[02468][048]00|[13579][26]00)-02-29|\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\d|30)|(?:02)-(?:0[1-9]|1\d|2[0-8])))T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/
);
export const admissionCandidateSchema = type
  .merge(discoveryObservationSchema, {
    candidateId: uuidSchema,
    provenance: type({
      "+": "reject",
      adapterId: text,
      port: type.unit(GamePort.Discovery),
      hostId: uuidSchema,
      sourceId: text
    }),
    "conflict?": type({
      "+": "reject",
      kind: type.enumerated(...Object.values(AdmissionConflictKind)),
      "recordIds?": text.array(),
      "issuer?": text
    }),
    disposition: type.enumerated(
      DiscoveryDisposition.NewGame,
      DiscoveryDisposition.ReuseGame,
      DiscoveryDisposition.ExistingInstallation,
      DiscoveryDisposition.Conflict
    ),
    locationValidation: type({
      "+": "reject",
      status: type.enumerated(
        LocationValidationStatus.Valid,
        LocationValidationStatus.Invalid,
        LocationValidationStatus.Unverified
      ),
      "reason?": text
    }),
    "existingGameId?": uuidSchema,
    "existingInstallationId?": uuidSchema,
    "reason?": text
  })
  .onDeepUndeclaredKey("reject");
export const gameDiscoveryPreviewSchema = type({
  "+": "reject",
  schemaVersion: type.unit(GAME_DISCOVERY_PREVIEW_SCHEMA),
  operationId: uuidSchema,
  createdAt: isoInstant,
  root: text,
  workspaceId: uuidSchema,
  revision: text,
  hostId: uuidSchema,
  sourceId: text,
  sourceKind: discoverySourceKindSchema,
  scope: discoveryScopeSchema,
  discoveryAdapterId: text,
  configurationAdapterId: text,
  candidates: admissionCandidateSchema.array(),
  diagnostics: discoveryDiagnosticSchema.array(),
  adapterResolutionPlan: adapterResolutionPlanSchema,
  digest: type.string.matching(/^[0-9a-f]{64}$/)
})
  .onDeepUndeclaredKey("reject")
  .narrow((preview, ctx) => {
    const ids = preview.candidates.map((candidate) => candidate.candidateId);
    const observations = preview.candidates.map((candidate) => candidate.observationKey);
    return (
      (new Set(ids).size === ids.length && new Set(observations).size === observations.length) ||
      ctx.mustBe("a preview with unique candidate IDs and observation keys")
    );
  });
export type GameDiscoveryPreview = (typeof gameDiscoveryPreviewSchema)["infer"];
export type AdmissionCandidate = (typeof admissionCandidateSchema)["infer"];
export const previewGameDiscoveryInputSchema = type({
  "+": "reject",
  root: text,
  hostId: uuidSchema,
  sourceId: text,
  scope: discoveryScopeSchema,
  "preferredAdapterId?": text,
  "configurationAdapterId?": text
}).onDeepUndeclaredKey("reject");
export type PreviewGameDiscoveryInput = (typeof previewGameDiscoveryInputSchema)["infer"];
export interface ImportGameDiscoveryInput {
  root: string;
  preview: unknown;
  selectedCandidateIds: string[];
  operationId?: string;
  hostId?: string;
  sourceId?: string;
}
export interface GameDiscoveryDependencies {
  ids: IdService;
  temporal: TemporalService;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}
function withoutDigest(preview: GameDiscoveryPreview) {
  const { digest: _, ...body } = preview;
  return body;
}
function requiredResolvedAdapter(plan: AdapterResolutionPlan, feature: string) {
  const resolvedAdapter = plan.resolvedAdapters.find((item) => item.feature === feature);
  if (!resolvedAdapter) {
    throw new AdapterResolutionUnavailableError({
      issue: {
        kind: AdapterResolutionUnavailableKind.Resolution,
        featureId: feature,
        reason: plan.unavailable.find((item) => item.feature === feature)?.reason
      },
      message:
        plan.unavailable.find((item) => item.feature === feature)?.reason ??
        `No adapter for ${feature}`
    });
  }
  return resolvedAdapter;
}
function identities(
  value: { externalIdentities?: ExternalIdentity[] },
  purpose: ExternalIdentityPurpose
) {
  return (value.externalIdentities ?? []).filter((identity) => identity.purpose === purpose);
}
function sharedIdentity(left: ExternalIdentity[], right: ExternalIdentity[]): boolean {
  return left.some((identity) => right.some((other) => canonical(identity) === canonical(other)));
}
function contradictoryIdentity(left: ExternalIdentity[], right: ExternalIdentity[]): boolean {
  return left.some((identity) =>
    right.some(
      (other) =>
        identity.issuer === other.issuer &&
        identity.purpose === other.purpose &&
        identity.value !== other.value
    )
  );
}

export function createAdmissionCandidateFromObservation(
  observation: DiscoveryObservation,
  assessment: Omit<AdmissionCandidate, keyof DiscoveryObservation | "candidateId" | "provenance">,
  candidateId: string,
  provenance: AdmissionCandidate["provenance"]
): AdmissionCandidate {
  return assertSchema("game.admission-candidate", admissionCandidateSchema, {
    ...observation,
    ...assessment,
    candidateId,
    provenance
  });
}

export function createGameFromAdmissionCandidate(
  candidate: AdmissionCandidate,
  id: string
): GameRecord {
  const externalIdentities = identities(candidate, ExternalIdentityPurpose.Game);
  return assertSchema("workspace.game", gameSchema, {
    schemaVersion: WORKSPACE_SCHEMA,
    kind: RecordKind.Game,
    id,
    uniformName: candidate.title,
    title: candidate.title,
    externalRefs: candidate.externalRefs,
    ...(externalIdentities.length ? { externalIdentities } : {}),
    settings: {}
  });
}

export function createInstallationFromAdmissionCandidate(
  candidate: AdmissionCandidate,
  identity: { id: string; gameId: string; hostId: string; sourceId: string }
): InstallationRecord {
  const externalIdentities = identities(candidate, ExternalIdentityPurpose.Installation);
  return assertSchema("workspace.installation", installationSchema, {
    schemaVersion: WORKSPACE_SCHEMA,
    kind: RecordKind.Installation,
    ...identity,
    uniformName: candidate.title,
    location: candidate.location,
    ...(externalIdentities.length ? { externalIdentities } : {}),
    launchEntries: [],
    settings: {}
  });
}

export class GameDiscoveryService {
  private readonly newId: () => Effect.Effect<string>;
  private readonly now: () => Effect.Effect<string>;
  constructor(
    private readonly plan: AdapterResolutionPlanner,
    private readonly adapterResolver: AdapterResolver,
    private readonly locations: LocationBehaviorService,
    dependencies: GameDiscoveryDependencies
  ) {
    this.newId = () => dependencies.ids.uuidV7();
    this.now = () => dependencies.temporal.now().pipe(Effect.map((value) => value.toString()));
  }

  preview(input: PreviewGameDiscoveryInput) {
    return Effect.gen({ self: this }, function* () {
      const request = input;
      const parsed = yield* admissionRule(
        "preview",
        (value: unknown) =>
          assertSchema("game.discovery-preview-input", previewGameDiscoveryInputSchema, value),
        request
      );
      return yield* this.observe(parsed, yield* this.newId(), yield* this.now());
    });
  }

  private observe(
    input: (typeof previewGameDiscoveryInputSchema)["infer"],
    operationId: string,
    createdAt: string,
    previousCandidates: readonly AdmissionCandidate[] = []
  ) {
    return Effect.gen({ self: this }, function* () {
      const configurationPlan = yield* this.plan.plan(
        [WorkspaceFeature.Inspect],
        input.configurationAdapterId
          ? {
              [WorkspaceFeature.Inspect]: input.configurationAdapterId
            }
          : {}
      );
      const readAdapter = yield* admissionRule(
        "observe",
        (...values: Parameters<typeof requiredResolvedAdapter>) =>
          requiredResolvedAdapter(...values),
        configurationPlan,
        WorkspaceFeature.Inspect
      );
      const importPlan = yield* this.plan.plan([WorkspaceFeature.Import], {
        [WorkspaceFeature.Import]: readAdapter.adapterId
      });
      const configuration = this.adapterResolver.implementation(
        readAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Implementation,
              featureId: WorkspaceFeature.Inspect,
              adapterId: readAdapter.adapterId,
              operation: WorkspaceOperation.Read
            },
            message: `Adapter ${readAdapter.adapterId} has no active configuration implementation`,
            operation: "observe"
          })
        );
      }
      const snapshot = yield* configuration.read({ root: input.root });
      yield* admissionRule(
        "observe",
        (...values: Parameters<typeof validateRelationships>) => validateRelationships(...values),
        snapshot
      );
      const host = snapshot.hosts.find((item) => item.id === input.hostId);
      if (!host) {
        return yield* Effect.fail(
          new WorkspaceNotFoundError({
            resource: WorkspaceResourceKind.Host,
            id: input.hostId,
            message: `Unknown discovery Host: ${input.hostId}`
          })
        );
      }
      const source = host.sources.find((item) => item.id === input.sourceId);
      if (!source) {
        return yield* Effect.fail(
          new WorkspaceNotFoundError({
            resource: WorkspaceResourceKind.Source,
            id: input.sourceId,
            hostId: host.id,
            message: `Discovery requires an existing configured source: ${input.sourceId}`
          })
        );
      }
      if (source.status !== SourceStatus.Configured) {
        return yield* Effect.fail(
          new GameDiscoveryUnavailableError({
            issue: {
              kind: GameDiscoveryUnavailableKind.SourceNotConfigured,
              hostId: host.id,
              sourceId: input.sourceId,
              status: source.status
            },
            message: `Discovery requires an existing configured source: ${input.sourceId}`,
            operation: "observe"
          })
        );
      }
      const sourceKind = yield* admissionRule(
        "observe",
        (value: unknown) =>
          assertSchema("game.discovery-source-kind", discoverySourceKindSchema, value),
        source.kind
      );
      const discoveryPlan = yield* this.plan.plan(
        [GameFeature.Discover],
        input.preferredAdapterId ? { [GameFeature.Discover]: input.preferredAdapterId } : {},
        { [GameFeature.Discover]: [discoverySourceCapability(sourceKind)] }
      );
      const resolvedAdapter = yield* admissionRule(
        "observe",
        (...values: Parameters<typeof requiredResolvedAdapter>) =>
          requiredResolvedAdapter(...values),
        discoveryPlan,
        GameFeature.Discover
      );
      const discovery = this.adapterResolver.implementation(
        resolvedAdapter,
        gameDiscoveryImplementation
      );
      if (!discovery) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Implementation,
              featureId: GameFeature.Discover,
              adapterId: resolvedAdapter.adapterId,
              operation: GameOperation.Discover
            },
            message: `Adapter ${resolvedAdapter.adapterId} has no active discovery implementation`,
            operation: "observe"
          })
        );
      }
      const observed = yield* admissionRule(
        "observe",
        (value: unknown) => assertSchema("game.discovery-result", gameDiscoveryResultSchema, value),
        yield* discovery.discover({
          hostId: host.id,
          sourceId: source.id,
          sourceKind,
          scope: input.scope
        })
      );
      const context = { platform: host.platform, roots: host.roots };
      const locationPlans: AdapterResolutionPlan[] = [];
      const seen = new Map<string, DiscoveryObservation>();
      for (const candidate of observed.observations) {
        const previous = seen.get(candidate.observationKey);
        if (previous && digest(previous) !== digest(candidate)) {
          return yield* Effect.fail(
            new GameDiscoveryConflictError({
              issue: {
                kind: GameDiscoveryConflictKind.ObservationKey,
                observationKey: candidate.observationKey,
                hostId: input.hostId,
                sourceId: input.sourceId
              },
              message: `Conflicting discovery observation key: ${candidate.observationKey}`,
              operation: "observe"
            })
          );
        }
        seen.set(candidate.observationKey, candidate);
      }
      const candidates: AdmissionCandidate[] = [];
      const previousByObservation = new Map(
        previousCandidates.map((candidate) => [candidate.observationKey, candidate])
      );
      for (const observation of [...seen.values()].sort((a, b) =>
        a.observationKey.localeCompare(b.observationKey)
      )) {
        const candidate: Omit<AdmissionCandidate, "candidateId" | "provenance"> =
          yield* this.classify(
            observation,
            snapshot,
            input.hostId,
            input.sourceId,
            context,
            locationPlans
          );
        const declared = observation.externalIdentities ?? [];
        if (
          declared.some((identity, index) =>
            declared
              .slice(0, index)
              .some(
                (previous) =>
                  previous.issuer === identity.issuer && previous.purpose === identity.purpose
              )
          )
        ) {
          candidate.disposition = DiscoveryDisposition.Conflict;
          candidate.reason = "Observation contains contradictory or duplicate external identities";
          candidate.conflict = { kind: AdmissionConflictKind.ObservationIdentity };
        }
        const issuer = observation.externalIdentities?.find(
          (identity) => identity.issuer !== resolvedAdapter.owner.id
        )?.issuer;
        if (issuer) {
          candidate.disposition = DiscoveryDisposition.Conflict;
          candidate.reason = "External identity issuer does not match the selected Adapter owner";
          candidate.conflict = { kind: AdmissionConflictKind.IdentityIssuer, issuer };
        }
        const existing = previousByObservation.get(observation.observationKey);
        candidates.push(
          yield* admissionRule(
            "observe",
            createAdmissionCandidateFromObservation,
            observation,
            candidate,
            existing?.candidateId ?? (yield* this.newId()),
            {
              adapterId: resolvedAdapter.adapterId,
              port: GamePort.Discovery,
              hostId: host.id,
              sourceId: source.id
            }
          )
        );
      }
      for (let index = 0; index < candidates.length; index++) {
        for (const previous of candidates.slice(0, index)) {
          const candidate = candidates[index]!;
          if (
            previous.locationValidation.status !== LocationValidationStatus.Valid ||
            candidate.locationValidation.status !== LocationValidationStatus.Valid
          ) {
            continue;
          }
          locationPlans.push(
            yield* this.locations.plan(LocationOperation.Compare, [
              previous.location,
              candidate.location
            ])
          );
          const comparison = yield* this.locations.compare({
            left: previous.location,
            right: candidate.location,
            context
          });
          const gameConflict = contradictoryIdentity(
            identities(previous, ExternalIdentityPurpose.Game),
            identities(candidate, ExternalIdentityPurpose.Game)
          );
          const installationConflict = contradictoryIdentity(
            identities(previous, ExternalIdentityPurpose.Installation),
            identities(candidate, ExternalIdentityPurpose.Installation)
          );
          const sameInstallation = sharedIdentity(
            identities(previous, ExternalIdentityPurpose.Installation),
            identities(candidate, ExternalIdentityPurpose.Installation)
          );
          if (
            (comparison.status === LocationComparisonStatus.Equal &&
              (gameConflict || installationConflict)) ||
            (comparison.status === LocationComparisonStatus.Different && sameInstallation)
          ) {
            candidate.disposition = DiscoveryDisposition.Conflict;
            candidate.reason =
              "Selected observations disagree on Game, Installation or Location identity";
            candidate.conflict = { kind: AdmissionConflictKind.ObservationLocationIdentity };
            previous.disposition = DiscoveryDisposition.Conflict;
            previous.reason = candidate.reason;
            previous.conflict = candidate.conflict;
          }
          if (
            comparison.status !== LocationComparisonStatus.Equal &&
            comparison.status !== LocationComparisonStatus.Different
          ) {
            candidate.disposition = DiscoveryDisposition.Conflict;
            candidate.conflict = { kind: AdmissionConflictKind.LocationComparison };
            candidate.reason = `Candidate Location comparison ${comparison.status}: ${comparison.reason ?? "identity cannot be established"}`;
          }
        }
      }
      const body = {
        schemaVersion: GAME_DISCOVERY_PREVIEW_SCHEMA,
        operationId,
        createdAt,
        root: input.root,
        workspaceId: snapshot.workspace.id,
        revision: snapshot.revision,
        hostId: host.id,
        sourceId: source.id,
        sourceKind,
        scope: input.scope,
        discoveryAdapterId: resolvedAdapter.adapterId,
        configurationAdapterId: readAdapter.adapterId,
        candidates,
        diagnostics: [
          ...observed.diagnostics,
          ...candidates
            .filter(
              (candidate) => candidate.locationValidation.status !== LocationValidationStatus.Valid
            )
            .map((candidate) => ({
              code: "location-unavailable",
              message: `${candidate.observationKey}: ${candidate.reason ?? candidate.locationValidation.status}`
            }))
        ],
        adapterResolutionPlan: {
          declarationProtocolVersion: configurationPlan.declarationProtocolVersion,
          resolvedAdapters: [
            ...configurationPlan.resolvedAdapters,
            ...importPlan.resolvedAdapters,
            ...discoveryPlan.resolvedAdapters,
            ...locationPlans.flatMap((plan) => plan.resolvedAdapters)
          ],
          unavailable: [
            ...importPlan.unavailable,
            ...locationPlans.flatMap((plan) => plan.unavailable)
          ]
        }
      };
      // Clone so a later adapter mutation cannot rewrite an issued preview.
      return structuredClone(
        yield* admissionRule(
          "observe",
          (value: unknown) =>
            assertSchema("game.discovery-preview", gameDiscoveryPreviewSchema, value),
          { ...body, digest: digest(body) }
        )
      );
    });
  }

  private classify(
    candidate: DiscoveryObservation,
    snapshot: WorkspaceSnapshot,
    hostId: string,
    sourceId: string,
    context: LocationContext,
    locationPlans: AdapterResolutionPlan[]
  ) {
    return Effect.gen({ self: this }, function* () {
      const validation = yield* this.locations.validate({
        location: candidate.location,
        context
      });
      locationPlans.push(
        yield* this.locations.plan(LocationOperation.Validate, [candidate.location])
      );
      const assessed = { ...candidate, locationValidation: validation };
      if (validation.status !== LocationValidationStatus.Valid) {
        return {
          ...assessed,
          disposition: DiscoveryDisposition.Conflict,
          conflict: { kind: AdmissionConflictKind.LocationValidation },
          reason: `Location unavailable: ${validation.reason ?? validation.status}`
        };
      }
      const installations: InstallationRecord[] = [];
      for (const item of snapshot.installations.filter((item) => item.hostId === hostId)) {
        locationPlans.push(
          yield* this.locations.plan(LocationOperation.Compare, [item.location, candidate.location])
        );
        const comparison = yield* this.locations.compare({
          left: item.location,
          right: candidate.location,
          context
        });
        if (comparison.status === LocationComparisonStatus.Equal) {
          installations.push(item);
        } else if (comparison.status !== LocationComparisonStatus.Different) {
          return {
            ...assessed,
            disposition: DiscoveryDisposition.Conflict,
            conflict: { kind: AdmissionConflictKind.LocationComparison },
            reason: `Location comparison ${comparison.status}: ${comparison.reason ?? "identity cannot be established"}`
          };
        }
      }
      const gameIdentities = identities(candidate, ExternalIdentityPurpose.Game);
      const installationIdentities = identities(candidate, ExternalIdentityPurpose.Installation);
      const matches = snapshot.games.filter((game) =>
        sharedIdentity(gameIdentities, game.externalIdentities ?? [])
      );
      const identityInstallations = snapshot.installations.filter((item) =>
        sharedIdentity(installationIdentities, item.externalIdentities ?? [])
      );
      const installedGame = snapshot.games.find((game) => game.id === installations[0]?.gameId);
      const ambiguous =
        installations.length > 1 ||
        matches.length > 1 ||
        identityInstallations.length > 1 ||
        (installations[0] && installations[0].sourceId !== sourceId) ||
        (installedGame &&
          contradictoryIdentity(gameIdentities, installedGame.externalIdentities ?? [])) ||
        (installations[0] &&
          contradictoryIdentity(
            installationIdentities,
            installations[0].externalIdentities ?? []
          )) ||
        (installations[0] && matches[0] && installations[0].gameId !== matches[0].id) ||
        identityInstallations.some((item) => item.id !== installations[0]?.id);
      if (ambiguous) {
        return {
          ...assessed,
          disposition: DiscoveryDisposition.Conflict,
          conflict: {
            kind: identityInstallations.some((item) => item.id !== installations[0]?.id)
              ? AdmissionConflictKind.InstallationLocationChanged
              : AdmissionConflictKind.ExternalIdentity,
            recordIds: [
              ...new Set(
                [...installations, ...identityInstallations, ...matches].map((item) => item.id)
              )
            ]
          },
          reason: "Conflicting existing Game, Installation or Location identity"
        };
      }
      if (installations[0]) {
        return {
          ...assessed,
          disposition: DiscoveryDisposition.ExistingInstallation,
          existingGameId: installations[0].gameId,
          existingInstallationId: installations[0].id
        };
      }
      if (matches[0]) {
        return {
          ...assessed,
          disposition: DiscoveryDisposition.ReuseGame,
          existingGameId: matches[0].id
        };
      }
      return { ...assessed, disposition: DiscoveryDisposition.NewGame };
    });
  }

  import(input: ImportGameDiscoveryInput) {
    return Effect.gen({ self: this }, function* () {
      const preview = yield* admissionRule(
        "import",
        (value: unknown) =>
          assertSchema("game.discovery-preview", gameDiscoveryPreviewSchema, value),
        input.preview
      );
      if (input.root !== preview.root) {
        return yield* Effect.fail(
          new GameDiscoveryReviewMismatchError({
            issue: {
              reviewKind: "game-discovery",
              kind: GameDiscoveryMismatchKind.Root,
              expected: preview.root,
              actual: input.root
            },
            message: "Discovery preview does not match the requested Workspace, Host or source",
            operation: "import"
          })
        );
      }
      if (input.hostId !== undefined && input.hostId !== preview.hostId) {
        return yield* Effect.fail(
          new GameDiscoveryReviewMismatchError({
            issue: {
              reviewKind: "game-discovery",
              kind: GameDiscoveryMismatchKind.Host,
              expected: preview.hostId,
              actual: input.hostId
            },
            message: "Discovery preview does not match the requested Workspace, Host or source",
            operation: "import"
          })
        );
      }
      if (input.sourceId !== undefined && input.sourceId !== preview.sourceId) {
        return yield* Effect.fail(
          new GameDiscoveryReviewMismatchError({
            issue: {
              reviewKind: "game-discovery",
              kind: GameDiscoveryMismatchKind.Source,
              expected: preview.sourceId,
              actual: input.sourceId
            },
            message: "Discovery preview does not match the requested Workspace, Host or source",
            operation: "import"
          })
        );
      }
      if (digest(withoutDigest(preview)) !== preview.digest) {
        return yield* Effect.fail(
          new GameDiscoveryReviewMismatchError({
            issue: {
              reviewKind: "game-discovery",
              kind: GameDiscoveryMismatchKind.Digest,
              expected: preview.digest,
              actual: digest(withoutDigest(preview))
            },
            message: "Discovery preview was modified",
            operation: "import"
          })
        );
      }
      if (input.operationId !== undefined && input.operationId !== preview.operationId) {
        return yield* Effect.fail(
          new GameDiscoveryReviewMismatchError({
            issue: {
              reviewKind: "game-discovery",
              kind: GameDiscoveryMismatchKind.OperationId,
              expected: preview.operationId,
              actual: input.operationId
            },
            message: "Discovery operation ID does not match preview",
            operation: "import"
          })
        );
      }
      const selected = yield* admissionRule(
        "import",
        (value: unknown) =>
          assertSchema(
            "game.discovery-selected-candidate-ids",
            text.array().atLeastLength(1),
            value
          ),
        input.selectedCandidateIds
      );
      if (new Set(selected).size !== selected.length) {
        return yield* Effect.fail(
          new GameDiscoveryInputError({
            issue: {
              kind: GameDiscoveryInputKind.DuplicateCandidates,
              candidateIds: selected.filter((key, index) => selected.indexOf(key) !== index)
            },
            message: "Duplicate selected candidate ID",
            operation: "import"
          })
        );
      }
      for (const key of selected) {
        if (!preview.candidates.some((item) => item.candidateId === key)) {
          return yield* Effect.fail(
            new GameDiscoveryNotFoundError({
              issue: { kind: "candidate", id: key },
              message: `Unknown selected candidate: ${key}`,
              operation: "import"
            })
          );
        }
      }
      const current = yield* this.observe(
        {
          root: input.root,
          hostId: preview.hostId,
          sourceId: preview.sourceId,
          scope: preview.scope,
          preferredAdapterId: preview.discoveryAdapterId,
          configurationAdapterId: preview.configurationAdapterId
        },
        preview.operationId,
        preview.createdAt,
        preview.candidates
      );
      if (current.digest !== preview.digest) {
        return yield* Effect.fail(
          new GameDiscoveryReviewMismatchError({
            issue: {
              reviewKind: "game-discovery",
              kind: GameDiscoveryMismatchKind.Stale,
              expected: preview.digest,
              actual: current.digest,
              expectedRevision: preview.revision,
              actualRevision: current.revision
            },
            message:
              "Discovery preview is stale: Workspace, source observation or Adapter resolution changed; preview again",
            operation: "import"
          })
        );
      }
      const importAdapter = yield* admissionRule(
        "import",
        (...values: Parameters<typeof requiredResolvedAdapter>) =>
          requiredResolvedAdapter(...values),
        yield* this.plan.plan([WorkspaceFeature.Import], {
          [WorkspaceFeature.Import]: current.configurationAdapterId
        }),
        WorkspaceFeature.Import
      );
      const configuration = this.adapterResolver.implementation(
        importAdapter,
        workspaceConfigurationImplementation
      );
      if (!configuration?.import) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Operation,
              featureId: WorkspaceFeature.Import,
              adapterId: current.configurationAdapterId,
              operation: WorkspaceOperation.Import
            },
            message: `Adapter ${current.configurationAdapterId} has no active import implementation`,
            operation: "import"
          })
        );
      }
      const games: GameRecord[] = [];
      const installations: InstallationRecord[] = [];
      const createdGames: { identities: ExternalIdentity[]; gameId: string }[] = [];
      const selectedLocations: {
        candidate: AdmissionCandidate;
        gameId?: string;
        installation: InstallationRecord;
      }[] = [];
      const snapshot = yield* configuration.read({ root: current.root });
      const host = snapshot.hosts.find((item) => item.id === current.hostId)!;
      const context = { platform: host.platform, roots: host.roots };
      for (const candidate of current.candidates.filter((item) =>
        selected.includes(item.candidateId)
      )) {
        if (candidate.disposition === DiscoveryDisposition.Conflict) {
          return yield* Effect.fail(
            new GameDiscoveryConflictError({
              issue: {
                kind: GameDiscoveryConflictKind.Candidate,
                candidateId: candidate.candidateId,
                hostId: current.hostId,
                sourceId: current.sourceId,
                reason: candidate.reason,
                conflict: candidate.conflict
              },
              message: `Conflicting candidate ${candidate.observationKey}: ${candidate.reason ?? candidate.conflict?.kind}`,
              operation: "import"
            })
          );
        }
        if (candidate.disposition === DiscoveryDisposition.ExistingInstallation) {
          continue;
        }
        let gameId = candidate.existingGameId;
        const gameIdentities = identities(candidate, ExternalIdentityPurpose.Game);
        const installationIdentities = identities(candidate, ExternalIdentityPurpose.Installation);
        let duplicate = false;
        for (const previous of selectedLocations) {
          const comparison = yield* this.locations.compare({
            left: previous.candidate.location,
            right: candidate.location,
            context
          });
          if (comparison.status === LocationComparisonStatus.Equal) {
            if (
              contradictoryIdentity(
                gameIdentities,
                identities(previous.candidate, ExternalIdentityPurpose.Game)
              ) ||
              contradictoryIdentity(
                installationIdentities,
                identities(previous.candidate, ExternalIdentityPurpose.Installation)
              ) ||
              (gameId && previous.gameId && gameId !== previous.gameId)
            ) {
              return yield* Effect.fail(
                new GameDiscoveryConflictError({
                  issue: {
                    kind: GameDiscoveryConflictKind.LocationIdentity,
                    candidateId: candidate.candidateId,
                    previousCandidateId: previous.candidate.candidateId,
                    hostId: current.hostId,
                    sourceId: current.sourceId
                  },
                  message: `Selected candidates disagree on installation identity: ${candidate.observationKey}`,
                  operation: "import"
                })
              );
            }
            const game = games.find((game) => game.id === previous.gameId);
            if (game && gameIdentities.length && !game.externalIdentities?.length) {
              game.externalIdentities = gameIdentities;
              const created = createdGames.find((entry) => entry.gameId === game.id);
              if (created) {
                created.identities = gameIdentities;
              }
            }
            if (
              installationIdentities.length &&
              !previous.installation.externalIdentities?.length
            ) {
              previous.installation.externalIdentities = installationIdentities;
            }
            duplicate = true;
            break;
          }
          if (comparison.status !== LocationComparisonStatus.Different) {
            return yield* Effect.fail(
              new GameDiscoveryUnavailableError({
                issue: {
                  kind: GameDiscoveryUnavailableKind.LocationComparison,
                  candidateId: candidate.candidateId,
                  previousCandidateId: previous.candidate.candidateId,
                  status: comparison.status
                },
                message: `Selected Location comparison ${comparison.status}: ${candidate.observationKey}`,
                operation: "import"
              })
            );
          }
        }
        if (duplicate) {
          continue;
        }
        gameId ??= createdGames.find((entry) =>
          sharedIdentity(entry.identities, gameIdentities)
        )?.gameId;
        if (!gameId) {
          gameId = yield* admissionRule(
            "import",
            (value: unknown) => assertSchema("workspace.uuid", uuidSchema, value),
            yield* this.newId()
          );
          games.push(
            yield* admissionRule("import", createGameFromAdmissionCandidate, candidate, gameId)
          );
          createdGames.push({ identities: gameIdentities, gameId });
        }
        const installation = yield* admissionRule(
          "import",
          createInstallationFromAdmissionCandidate,
          candidate,
          {
            id: yield* this.newId(),
            gameId,
            hostId: current.hostId,
            sourceId: current.sourceId
          }
        );
        installations.push(installation);
        selectedLocations.push({ candidate, gameId, installation });
      }
      if (!installations.length) {
        return {
          status: ImportStatus.Unchanged,
          operationId: current.operationId,
          revision: current.revision,
          gameIds: [],
          installationIds: [],
          adapterResolutionPlan: current.adapterResolutionPlan
        };
      }
      const result = yield* configuration.import({
        root: current.root,
        expectedRevision: current.revision,
        operationId: current.operationId,
        games,
        installations
      });
      return { ...result, adapterResolutionPlan: current.adapterResolutionPlan };
    });
  }
}

export class GAME_ADMISSION extends Context.Service<GAME_ADMISSION, GameDiscoveryService>()(
  "game.admission"
) {}

export function provideGameAdmission() {
  return Layer.effect(
    GAME_ADMISSION,
    Effect.gen(function* () {
      return new GameDiscoveryService(
        yield* ADAPTER_RESOLUTION_PLANNER,
        yield* ADAPTER_RESOLVER,
        yield* LOCATION_BEHAVIOR,
        { ids: yield* ID_SERVICE, temporal: yield* TEMPORAL_SERVICE }
      );
    })
  );
}
