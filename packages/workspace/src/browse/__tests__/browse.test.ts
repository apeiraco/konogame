import { it } from "@effect/vitest";
import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  DECLARATION_PROTOCOL_RANGE,
  LOCATION_BEHAVIOR_PORT,
  LocationCapability,
  type LocationContract,
  LocationOperation,
  LocationPortId,
  LocationResolutionStatus,
  type LocationTypeDefinition,
  LocationValidationStatus,
  type ResourceReference
} from "@konogame/infrastructure/contracts";
import {
  HistoryMode,
  RecordKind,
  WORKSPACE_SCHEMA,
  WorkspaceCapability,
  type WorkspaceConfigurationPort,
  type WorkspaceLocationBrowserPort,
  WorkspaceOperation,
  WorkspacePort,
  WorkspaceProbeStatus,
  workspaceModule
} from "@konogame/workspace";
import {
  WORKSPACE_CONFIGURATION_PORT,
  WORKSPACE_LOCATION_BROWSER_PORT
} from "@konogame/workspace/contracts";
import { Effect, Exit } from "effect";
import { describe, expect } from "vitest";
import { createApplication } from "../../../../../tests/support/use-cases.ts";

// A synthetic Location type with no `path`: the service must forward it untouched.
const shelfOwner = "fixture.shelf";
const shelfType: LocationTypeDefinition = {
  type: "synthetic.shelf",
  schemaVersion: "1.0.0",
  schemaRange: "1.0.0",
  dataSchema: {
    type: "object",
    additionalProperties: false,
    required: ["shelf"],
    properties: { shelf: { type: "string", minLength: 1 } }
  }
};
const shelf = (name: string): LocationContract => ({
  type: shelfType.type,
  schemaVersion: shelfType.schemaVersion,
  data: { shelf: name }
});
const shelfLocations = [{ type: shelfType.type, schemaRange: shelfType.schemaRange }];
const owner = { kind: AdapterOwnerKind.Extension, id: shelfOwner };

const shelfBehaviorAdapter: AdapterDescriptor = {
  id: "fixture.shelf-location",
  owner,
  port: LocationPortId,
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  portVersionRange: LOCATION_BEHAVIOR_PORT.supportedRange,
  operations: [LocationOperation.Validate, LocationOperation.Resolve],
  capabilities: [LocationCapability.Validate, LocationCapability.Resolve],
  locations: shelfLocations
};
const shelfBrowserAdapter: AdapterDescriptor = {
  id: "fixture.shelf-browser",
  owner,
  port: WorkspacePort.LocationBrowser,
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  portVersionRange: WORKSPACE_LOCATION_BROWSER_PORT.supportedRange,
  operations: [WorkspaceOperation.List],
  capabilities: [],
  locations: shelfLocations
};
function configurationAdapter(id: string, probe: boolean): AdapterDescriptor {
  return {
    id,
    owner: { kind: AdapterOwnerKind.Extension, id: `fixture.${id}` },
    port: WorkspacePort.Configuration,
    declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
    portVersionRange: WORKSPACE_CONFIGURATION_PORT.supportedRange,
    operations: probe
      ? [WorkspaceOperation.Read, WorkspaceOperation.Probe]
      : [WorkspaceOperation.Read],
    capabilities: [WorkspaceCapability.Records]
  };
}

const workspaceRecord = {
  kind: RecordKind.Workspace,
  schemaVersion: WORKSPACE_SCHEMA,
  id: "019a0000-0000-7000-8000-0000000000aa",
  name: "Synthetic browse fixture",
  defaults: {},
  history: { mode: HistoryMode.Disabled }
} as const;

interface Calls {
  readonly listed: (LocationContract | undefined)[];
  readonly probed: ResourceReference[];
  readonly read: string[];
}

function fixtures(calls: Calls) {
  const browser: WorkspaceLocationBrowserPort = {
    list: ({ location }) =>
      Effect.sync(() => {
        calls.listed.push(location);
        return location
          ? {
              entries: [{ location: shelf("B-12"), label: "Shelf B-12", canBrowse: false }],
              complete: true
            }
          : {
              entries: [{ location: shelf("A"), label: "Archive", canBrowse: true }],
              complete: true
            };
      })
  };
  const configuration = (probe: boolean): WorkspaceConfigurationPort => ({
    read: ({ root }) =>
      Effect.sync(() => {
        calls.read.push(root);
        return {
          workspace: workspaceRecord,
          games: [],
          hosts: [],
          installations: [],
          revision: "synthetic"
        };
      }),
    ...(probe
      ? {
          probe: ({ resource }) =>
            Effect.sync(() => {
              calls.probed.push(resource);
              return { status: WorkspaceProbeStatus.Present, root: "/synthetic/opened" };
            })
        }
      : {})
  });
  const behavior = {
    validate: () => Effect.succeed({ status: LocationValidationStatus.Valid }),
    resolve: ({ location }: { location: LocationContract }) =>
      Effect.succeed({
        status: LocationResolutionStatus.Resolved,
        resource: { type: "synthetic.shelf-resource", schemaVersion: "1.0.0", data: location.data }
      })
  };
  return { browser, configuration, behavior };
}

function application(options: { browser: boolean; probe: boolean; calls: Calls }) {
  const { browser, configuration, behavior } = fixtures(options.calls);
  const config = configurationAdapter(
    options.probe ? "probing-configuration" : "read-only-configuration",
    options.probe
  );
  return createApplication(
    [workspaceModule],
    [config, shelfBehaviorAdapter, ...(options.browser ? [shelfBrowserAdapter] : [])],
    new Map(),
    new Map([[config.id, configuration(options.probe)]]),
    new Map(),
    new Map(),
    {},
    {
      browsers: options.browser ? new Map([[shelfBrowserAdapter.id, browser]]) : new Map(),
      locationBehaviors: new Map([[shelfBehaviorAdapter.id, behavior]]),
      locationTypes: new Map([[shelfOwner, [shelfType]]])
    }
  );
}

const newCalls = (): Calls => ({ listed: [], probed: [], read: [] });

describe("Workspace location browsing", () => {
  it.effect("refuses invalid scan limits before calling the browser Adapter", () =>
    Effect.gen(function* () {
      const calls = newCalls();
      const { browse } = yield* application({ browser: true, probe: true, calls });
      for (const limit of [NaN, Infinity, 0, 1.5]) {
        expect((yield* Effect.flip(browse.list({ limit })))._tag).toBe("SchemaValidationError");
      }
      expect(calls.listed).toEqual([]);
    })
  );

  it.effect("forwards complete synthetic Locations to the browser and back unchanged", () =>
    Effect.gen(function* () {
      const calls = newCalls();
      const { browse } = yield* application({ browser: true, probe: true, calls });
      const start = yield* browse.list();
      expect(start.entries).toEqual([{ location: shelf("A"), label: "Archive", canBrowse: true }]);
      expect(start.adapterResolutionPlan.resolvedAdapters[0]?.adapterId).toBe(
        shelfBrowserAdapter.id
      );
      const child = yield* browse.list({ location: shelf("A") });
      expect(child.entries[0]?.location).toEqual(shelf("B-12"));
      expect(calls.listed).toEqual([undefined, shelf("A")]);
    })
  );

  it.effect("probes only the given location through its resolved resource", () =>
    Effect.gen(function* () {
      const calls = newCalls();
      const { browse } = yield* application({ browser: true, probe: true, calls });
      const result = yield* browse.probe({ location: shelf("B-12") });
      expect(result).toMatchObject({
        status: WorkspaceProbeStatus.Present,
        root: "/synthetic/opened"
      });
      expect(calls.probed).toEqual([
        { type: "synthetic.shelf-resource", schemaVersion: "1.0.0", data: { shelf: "B-12" } }
      ]);
      expect(calls.listed).toEqual([]);
    })
  );

  it.effect(
    "reports an unavailable probe when the configuration Adapter only reads, and still browses",
    () =>
      Effect.gen(function* () {
        const calls = newCalls();
        const { browse, workspace } = yield* application({ browser: true, probe: false, calls });
        const result = yield* browse.probe({ location: shelf("A") });
        expect(result.status).toBe(WorkspaceProbeStatus.Unavailable);
        expect(calls.probed).toEqual([]);
        expect((yield* browse.list()).entries).toHaveLength(1);
        // A typed path still opens through the formal read.
        yield* workspace.read("/synthetic/typed");
        expect(calls.read).toHaveLength(1);
      })
  );

  it.effect("keeps typed paths working when no browser Adapter is installed", () =>
    Effect.gen(function* () {
      const calls = newCalls();
      const { browse, workspace } = yield* application({ browser: false, probe: true, calls });
      const exit = yield* Effect.exit(browse.list());
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("AdapterResolutionUnavailableError");
      }
      const { snapshot } = yield* workspace.read("/synthetic/typed");
      expect(snapshot.workspace.name).toBe("Synthetic browse fixture");
    })
  );
});
