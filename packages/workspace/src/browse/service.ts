import {
  ADAPTER_RESOLVER,
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind,
  type AdapterResolver,
  FeatureNotFoundError,
  LOCATION_BEHAVIOR,
  type LocationBehaviorService
} from "@konogame/infrastructure";
import {
  type AdapterResolutionPlan,
  assertSchema,
  type LocationContract,
  LocationResolutionStatus
} from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";
import { workspaceRule } from "../management/errors.ts";
import {
  WORKSPACE_BROWSE_LIMIT,
  type WorkspaceBrowseListing,
  type WorkspaceProbeResult,
  WorkspaceProbeStatus,
  workspaceBrowseLimitSchema
} from "../model/browse.ts";
import { WorkspaceFeature } from "../model/vocabulary.ts";
import {
  workspaceConfigurationImplementation,
  workspaceLocationBrowserImplementation
} from "../ports/implementation.ts";

/**
 * Coordinates browsing for a Workspace to open. Location semantics stay in the selected Adapters:
 * this service forwards complete Locations and never reads their data.
 */
export class WorkspaceBrowseService {
  constructor(
    private readonly adapterResolver: AdapterResolver,
    private readonly locations: LocationBehaviorService
  ) {}

  private resolveFeature(featureId: string, locations: readonly LocationContract[]) {
    return Effect.gen({ self: this }, function* () {
      yield* this.adapterResolver.prepared;
      const feature = this.adapterResolver.features().find((item) => item.id === featureId);
      if (!feature) {
        return yield* Effect.fail(
          new FeatureNotFoundError({
            issue: { kind: "feature", id: featureId },
            message: `Unknown feature: ${featureId}`,
            operation: "browse"
          })
        );
      }
      return yield* this.adapterResolver.resolve([{ feature, locations }]);
    });
  }

  list(input: { readonly location?: LocationContract; readonly limit?: number } = {}) {
    return Effect.gen({ self: this }, function* () {
      const limit = yield* workspaceRule("browse", () =>
        assertSchema(
          "workspace.browse.limit",
          workspaceBrowseLimitSchema,
          input.limit ?? WORKSPACE_BROWSE_LIMIT.Default
        )
      );
      const adapterResolutionPlan = yield* this.resolveFeature(
        WorkspaceFeature.Browse,
        input.location ? [input.location] : []
      );
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      const browser = resolvedAdapter
        ? this.adapterResolver.implementation(
            resolvedAdapter,
            workspaceLocationBrowserImplementation
          )
        : undefined;
      if (!resolvedAdapter || !browser) {
        return yield* Effect.fail(
          new AdapterResolutionUnavailableError({
            issue: {
              kind: AdapterResolutionUnavailableKind.Resolution,
              featureId: WorkspaceFeature.Browse,
              reason: adapterResolutionPlan.unavailable[0]?.reason
            },
            message:
              adapterResolutionPlan.unavailable[0]?.reason ??
              "No Workspace location browser is available",
            operation: "browse"
          })
        );
      }
      const listing: WorkspaceBrowseListing = yield* browser.list({
        ...(input.location ? { location: input.location } : {}),
        limit
      });
      return { ...listing, adapterResolutionPlan };
    });
  }

  /**
   * Probes only the selected location. An unavailable result leaves manual entry usable: it never
   * claims the location is not a Workspace.
   */
  probe(input: { readonly location: LocationContract; readonly preferredAdapterId?: string }) {
    return Effect.gen({ self: this }, function* () {
      const resolution = yield* this.locations.resolve({ location: input.location });
      const unavailable = (
        reason: string,
        adapterResolutionPlan?: AdapterResolutionPlan
      ): WorkspaceProbeResult & { adapterResolutionPlan?: AdapterResolutionPlan } => ({
        status: WorkspaceProbeStatus.Unavailable,
        reason,
        ...(adapterResolutionPlan ? { adapterResolutionPlan } : {})
      });
      if (resolution.status !== LocationResolutionStatus.Resolved) {
        return unavailable(resolution.reason ?? "The Location could not be resolved");
      }
      const feature = this.adapterResolver
        .features()
        .find((item) => item.id === WorkspaceFeature.Probe);
      if (!feature) {
        return unavailable(`Unknown feature: ${WorkspaceFeature.Probe}`);
      }
      const adapterResolutionPlan = yield* this.adapterResolver.resolve([
        {
          feature,
          ...(input.preferredAdapterId ? { preferredAdapterId: input.preferredAdapterId } : {})
        }
      ]);
      const resolvedAdapter = adapterResolutionPlan.resolvedAdapters[0];
      const configuration = resolvedAdapter
        ? this.adapterResolver.implementation(resolvedAdapter, workspaceConfigurationImplementation)
        : undefined;
      if (!configuration?.probe) {
        return unavailable(
          adapterResolutionPlan.unavailable[0]?.reason ??
            "No configuration Adapter can probe a location",
          adapterResolutionPlan
        );
      }
      const result = yield* configuration.probe({ resource: resolution.resource });
      return { ...result, adapterResolutionPlan };
    });
  }
}

export class WORKSPACE_BROWSE extends Context.Service<WORKSPACE_BROWSE, WorkspaceBrowseService>()(
  "workspace.browse"
) {}

export function provideWorkspaceBrowse() {
  return Layer.effect(
    WORKSPACE_BROWSE,
    Effect.gen(function* () {
      const [resolver, locations] = yield* Effect.all([ADAPTER_RESOLVER, LOCATION_BEHAVIOR]);
      return new WorkspaceBrowseService(resolver, locations);
    })
  );
}
