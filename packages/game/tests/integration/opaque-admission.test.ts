import { it } from "@effect/vitest";
import {
  type DiscoveryObservation,
  type GameDiscoveryPort,
  gameDiscoveryImplementation,
  gameModule
} from "@konogame/game";
import {
  ADAPTER_RESOLVER,
  defineExtensionModule,
  LOCATION_BEHAVIOR
} from "@konogame/infrastructure";
import {
  type AdapterDescriptor,
  LocationCapability,
  type LocationContract,
  type LocationPort,
  locationImplementation
} from "@konogame/infrastructure/contracts";
import { deterministicIdLayer, fixedTemporalLayer } from "@konogame/infrastructure/tests/support";
import {
  WORKSPACE_SCHEMA,
  type WorkspaceConfigurationPort,
  type WorkspaceSnapshot,
  workspaceConfigurationImplementation,
  workspaceModule
} from "@konogame/workspace";
import { Context, Effect, Layer } from "effect";
import { expect } from "vitest";
import { assertFailure } from "../../../../tests/support/assertions.ts";
import { createApplicationContext, useCases } from "../../../../tests/support/use-cases.ts";

const workspaceId = "019a0000-0000-7000-8000-000000000001";
const hostId = "019a0000-0000-7000-8000-000000000002";
const opaque = (objectId: string, label = "display"): LocationContract => ({
  type: "synthetic.object",
  schemaVersion: "1.0.0",
  data: { tenant: "lab", objectId, label }
});
function fixture() {
  return Effect.gen(function* () {
    const config: AdapterDescriptor = {
      id: "synthetic.configuration",
      owner: { kind: "module", id: workspaceModule.id },
      declarationProtocolRange: "^0.2.0",
      port: "workspace.configuration",
      portVersionRange: "^0.2.0",
      operations: ["read", "import"],
      capabilities: ["configuration.records", "configuration.import"]
    };
    const discovery: AdapterDescriptor = {
      id: "synthetic.discovery",
      owner: { kind: "extension", id: "synthetic" },
      declarationProtocolRange: "^0.2.0",
      port: "game.discovery",
      portVersionRange: "^0.3.0",
      operations: ["discover"],
      capabilities: ["discovery.local", "discovery.scoped", "discovery.source.synthetic"]
    };
    const location: AdapterDescriptor = {
      id: "synthetic.location",
      owner: { kind: "extension", id: "synthetic" },
      declarationProtocolRange: "^0.2.0",
      port: "location.behavior",
      portVersionRange: "^0.2.0",
      operations: ["validate", "compare", "resolve"],
      capabilities: Object.values(LocationCapability),
      locations: [{ type: "synthetic.object", schemaRange: "^1.0.0" }]
    };
    const foreign: AdapterDescriptor = {
      ...location,
      id: "synthetic.foreign",
      locations: [{ type: "synthetic.foreign", schemaRange: "^1.0.0" }]
    };
    let comparisons = 0;
    const behavior: LocationPort = {
      validate({ location }) {
        return Effect.sync(() => {
          return {
            status:
              typeof location.data === "object" &&
              !Array.isArray(location.data) &&
              typeof location.data.objectId === "string"
                ? ("valid" as const)
                : ("invalid" as const)
          };
        });
      },
      compare({ left, right }) {
        return Effect.sync(() => {
          comparisons++;
          const a = left.data as {
            tenant: string;
            objectId: string;
          };
          const b = right.data as typeof a;
          return {
            status:
              a.tenant === b.tenant && a.objectId === b.objectId
                ? ("equal" as const)
                : ("different" as const)
          };
        });
      },
      resolve({ location }) {
        return Effect.sync(() => {
          return {
            status: "resolved" as const,
            resource: {
              type: "synthetic.handle",
              schemaVersion: "1.0.0",
              data: {
                token: (
                  location.data as {
                    objectId: string;
                  }
                ).objectId
              }
            }
          };
        });
      }
    };
    const snapshot: WorkspaceSnapshot = {
      workspace: {
        schemaVersion: WORKSPACE_SCHEMA,
        kind: "workspace",
        id: workspaceId,
        name: "Opaque resources",
        defaults: {},
        history: { mode: "disabled" }
      },
      hosts: [
        {
          schemaVersion: WORKSPACE_SCHEMA,
          kind: "host",
          id: hostId,
          uniformName: "Synthetic",
          label: "Synthetic",
          platform: "linux",
          roots: {},
          defaults: {},
          gameOverrides: {},
          sources: [{ id: "remote", kind: "synthetic", status: "configured" as const }]
        }
      ],
      games: [],
      installations: [],
      revision: "one"
    };
    const candidates: DiscoveryObservation[] = [
      {
        observationKey: "first",
        title: "Same title",
        location: opaque("A"),
        externalRefs: [],
        externalIdentities: [{ issuer: "synthetic", purpose: "game", value: "product:42" }],
        evidence: [
          { kind: "directory", path: "D:/synthetic-observation", fingerprint: "synthetic-stable" }
        ]
      }
    ];
    let writes = 0;
    const configuration: WorkspaceConfigurationPort = {
      read() {
        return Effect.sync(() => {
          return structuredClone(snapshot);
        });
      },
      import(input) {
        return Effect.sync(() => {
          writes++;
          snapshot.games.push(...input.games);
          snapshot.installations.push(...input.installations);
          snapshot.revision = "two";
          return {
            status: "imported" as const,
            operationId: input.operationId,
            revision: "two",
            gameIds: input.games.map((item) => item.id),
            installationIds: input.installations.map((item) => item.id)
          };
        });
      }
    };
    const observations: GameDiscoveryPort = {
      discover() {
        return Effect.sync(() => {
          return { observations: structuredClone(candidates), diagnostics: [] };
        });
      }
    };
    const graph = yield* createApplicationContext(
      [
        {
          kind: "module",
          manifest: { ...workspaceModule, contributes: { adapters: [config] } },
          load: () =>
            Effect.succeed(
              defineExtensionModule({
                activate: (activation) =>
                  activation.registerAdapter(
                    config.id,
                    workspaceConfigurationImplementation,
                    configuration
                  )
              })
            )
        },
        {
          kind: "module",
          manifest: gameModule,
          load: () => Effect.succeed(defineExtensionModule({ activate: () => Effect.void }))
        },
        {
          kind: "extension",
          manifest: {
            id: "synthetic",
            version: "1.0.0",
            declarationProtocolRange: "^0.2.0",
            software: {},
            contributes: {
              adapters: [discovery, location, foreign],
              locations: ["synthetic.object", "synthetic.foreign"].map((type) => ({
                type,
                schemaVersion: "1.0.0",
                schemaRange: "^1.0.0",
                dataSchema: { type: "object" }
              }))
            }
          },
          load: () =>
            Effect.succeed(
              defineExtensionModule({
                activate: (activation) =>
                  Effect.gen(function* () {
                    yield* activation.registerAdapter(
                      location.id,
                      locationImplementation,
                      behavior
                    );
                    yield* activation.registerAdapter(foreign.id, locationImplementation, behavior);
                    yield* activation.registerAdapter(
                      discovery.id,
                      gameDiscoveryImplementation,
                      observations
                    );
                  })
              })
            )
        }
      ],
      Layer.merge(deterministicIdLayer(), fixedTemporalLayer())
    );
    const app = useCases(graph);
    const adapterResolver = Context.get(graph, ADAPTER_RESOLVER);
    const locations = Context.get(graph, LOCATION_BEHAVIOR);
    const request = {
      root: "opaque-workspace",
      hostId,
      sourceId: "remote",
      scope: { paths: ["D:/synthetic"], maxDepth: 0, exclude: [] }
    };
    return {
      app,
      request,
      snapshot,
      candidates,
      adapterResolver,
      locations,
      get writes() {
        return writes;
      },
      get comparisons() {
        return comparisons;
      }
    };
  });
}
it.effect(
  "opaque candidates compare by resolved Adapter identity and inspect resolves a resource without a path",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.candidates.push({
        ...f.candidates[0]!,
        observationKey: "alias",
        externalIdentities: [{ issuer: "synthetic", purpose: "installation", value: "object:A" }],
        location: opaque("A", "different JSON")
      });
      const preview = yield* f.app.admission.preview(f.request);
      expect(
        preview.adapterResolutionPlan.resolvedAdapters.some(
          (resolvedAdapter) =>
            resolvedAdapter.adapterId === "synthetic.location" &&
            resolvedAdapter.operation === "compare"
        )
      ).toBe(true);
      yield* f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: preview.candidates
          .filter((candidate) => ["first", "alias"].includes(candidate.observationKey))
          .map((candidate) => candidate.candidateId)
      });
      expect(f.snapshot.installations).toHaveLength(1);
      expect(f.snapshot.installations[0]!.externalIdentities).toEqual([
        { issuer: "synthetic", purpose: "installation", value: "object:A" }
      ]);
      expect(f.snapshot.games[0]!.externalIdentities).toEqual([
        { issuer: "synthetic", purpose: "game", value: "product:42" }
      ]);
      expect(f.comparisons).toBeGreaterThan(0);
      f.candidates.splice(1);
      f.candidates[0]!.location = opaque("A", "another display value");
      expect((yield* f.app.admission.preview(f.request)).candidates[0]?.disposition).toBe(
        "existing-installation"
      );
      const inspected = yield* f.app.workspace.inspectWorkspace(f.request.root);
      expect(inspected.installations[0]?.locationStatus.availability).toEqual({
        status: "resolved" as const,
        resource: { type: "synthetic.handle", schemaVersion: "1.0.0", data: { token: "A" } }
      });
      expect(inspected.installations[0]).not.toHaveProperty("resolvedPath");
    })
);
it.effect(
  "opaque object IDs remain case sensitive and matching names cannot merge installations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.candidates.push({
        ...f.candidates[0]!,
        observationKey: "lowercase",
        location: opaque("a")
      });
      const preview = yield* f.app.admission.preview(f.request);
      yield* f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: preview.candidates.map((candidate) => candidate.candidateId)
      });
      expect(f.snapshot.games).toHaveLength(1);
      expect(f.snapshot.installations).toHaveLength(2);
    })
);
it.effect(
  "cross-type locations are explicitly incomparable and unknown or unsupported types cannot execute",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const locations = f.locations;
      const left = opaque("A");
      const right = { ...left, type: "synthetic.foreign" };
      expect((yield* locations.compare({ left, right })).status).toBe("incomparable");
      for (const location of [
        { ...left, type: "missing.type" },
        { ...left, schemaVersion: "2.0.0" }
      ]) {
        expect((yield* locations.validate({ location })).status).toBe("unverified");
        expect((yield* locations.resolve({ location })).status).toBe("unavailable");
        f.candidates[0]!.location = location;
        const preview = yield* f.app.admission.preview(f.request);
        expect(preview.candidates[0]?.location).toEqual(location);
        expect(preview.candidates[0]?.locationValidation.status).toBe("unverified");
        yield* assertFailure(
          f.app.admission.import({
            root: f.request.root,
            preview,
            selectedCandidateIds: [
              preview.candidates.find((candidate) => candidate.observationKey === "first")!
                .candidateId
            ]
          }),
          /Conflicting/
        );
      }
      f.candidates[0]!.location = left;
      f.candidates.push({ ...f.candidates[0]!, observationKey: "foreign", location: right });
      const preview = yield* f.app.admission.preview(f.request);
      expect(
        preview.candidates.find((candidate) => candidate.observationKey === "foreign")?.disposition
      ).toBe("conflict");
      yield* assertFailure(
        f.app.admission.import({
          root: f.request.root,
          preview,
          selectedCandidateIds: [
            preview.candidates.find((candidate) => candidate.observationKey === "foreign")!
              .candidateId
          ]
        }),
        /Conflicting/
      );
      expect(f.writes).toBe(0);
    })
);
it.effect(
  "an unknown candidate stays visible without blocking a separately selected valid resource",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.candidates.push({
        ...f.candidates[0]!,
        observationKey: "unknown",
        location: { ...opaque("B"), type: "missing.type" }
      });
      const preview = yield* f.app.admission.preview(f.request);
      expect(
        preview.candidates.find((item) => item.observationKey === "unknown")?.locationValidation
          .status
      ).toBe("unverified");
      expect(preview.candidates.find((item) => item.observationKey === "first")?.disposition).toBe(
        "new-game"
      );
      expect(preview.diagnostics.some((item) => item.code === "location-unavailable")).toBe(true);
      yield* f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: [
          preview.candidates.find((candidate) => candidate.observationKey === "first")!.candidateId
        ]
      });
      expect(f.snapshot.installations).toHaveLength(1);
    })
);

it.effect(
  "selection IDs belong to one preview and remain unchanged during evidence revalidation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const preview = yield* f.app.admission.preview(f.request);
      const next = yield* f.app.admission.preview(f.request);
      expect(next.candidates[0]!.candidateId).not.toBe(preview.candidates[0]!.candidateId);
      expect(preview.candidates[0]!.candidateId).not.toBe(preview.candidates[0]!.observationKey);
      expect(preview.candidates[0]!.provenance).toEqual({
        adapterId: "synthetic.discovery",
        port: "game.discovery",
        hostId,
        sourceId: "remote"
      });
      yield* assertFailure(
        f.app.admission.import({
          root: f.request.root,
          preview,
          selectedCandidateIds: [next.candidates[0]!.candidateId]
        }),
        /Unknown selected/
      );
      yield* f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      });
      expect(f.snapshot.games[0]!.id).not.toBe(preview.candidates[0]!.candidateId);
      expect(f.snapshot.installations[0]!.id).not.toBe(preview.candidates[0]!.candidateId);
    })
);
it.effect(
  "a synthetic Extension keeps game identities separate by issuer and descriptive references never merge",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.snapshot.games.push({
        schemaVersion: WORKSPACE_SCHEMA,
        kind: "game",
        id: "019a0000-0000-7000-8000-000000000099",
        uniformName: "Same title",
        title: "Same title",
        externalRefs: [],
        externalIdentities: [{ issuer: "other.extension", purpose: "game", value: "product:42" }],
        settings: {}
      });
      const preview = yield* f.app.admission.preview(f.request);
      expect(preview.candidates[0]!.disposition).toBe("new-game");
      yield* f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      });
      expect(f.snapshot.games).toHaveLength(2);
      expect(f.snapshot.games[1]!.externalIdentities).toEqual([
        { issuer: "synthetic", purpose: "game", value: "product:42" }
      ]);
      delete f.candidates[0]!.externalIdentities;
      f.candidates[0]!.externalRefs = [
        { authority: "example", kind: "product", key: { id: "42" } }
      ];
      f.candidates[0]!.location = opaque("new-object");
      const weak = yield* f.app.admission.preview(f.request);
      expect(weak.candidates[0]!.disposition).toBe("new-game");
    })
);
it.effect("an Adapter cannot issue another Extension's external identity", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.candidates[0]!.externalIdentities = [
      { issuer: "other.extension", purpose: "game", value: "product:42" }
    ];
    const preview = yield* f.app.admission.preview(f.request);
    expect(preview.candidates[0]!.conflict).toEqual({
      kind: "identity-issuer",
      issuer: "other.extension"
    });
    yield* assertFailure(
      f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      }),
      /Conflicting/
    );
    expect(f.writes).toBe(0);
  })
);
it.effect(
  "one Game can have multiple installations while an installation identity cannot occupy two Locations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const gameIdentity = { issuer: "synthetic", purpose: "game" as const, value: "product:42" };
      const installationIdentity = {
        issuer: "synthetic",
        purpose: "installation" as const,
        value: "object:A"
      };
      f.candidates[0]!.externalIdentities = [gameIdentity, installationIdentity];
      f.candidates.push({
        ...f.candidates[0]!,
        observationKey: "second",
        location: opaque("B"),
        externalIdentities: [gameIdentity, { ...installationIdentity, value: "object:B" }]
      });
      const preview = yield* f.app.admission.preview(f.request);
      yield* f.app.admission.import({
        root: f.request.root,
        preview,
        selectedCandidateIds: preview.candidates.map((candidate) => candidate.candidateId)
      });
      expect(f.snapshot.games).toHaveLength(1);
      expect(f.snapshot.installations).toHaveLength(2);
      expect(f.snapshot.installations[0]!.externalIdentities).toHaveLength(1);
      f.candidates.splice(1);
      f.candidates[0]!.location = opaque("moved-object");
      const moved = yield* f.app.admission.preview(f.request);
      expect(moved.candidates[0]!.conflict?.kind).toBe("installation-location-changed");
      yield* assertFailure(
        f.app.admission.import({
          root: f.request.root,
          preview: moved,
          selectedCandidateIds: [moved.candidates[0]!.candidateId]
        }),
        /Conflicting/
      );
      expect(f.writes).toBe(1);
      expect(f.snapshot.installations).toHaveLength(2);
    })
);
it.effect(
  "same-batch installation identity contradictions mark both observations before confirmation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      f.candidates[0]!.externalIdentities!.push({
        issuer: "synthetic",
        purpose: "installation",
        value: "object:A"
      });
      f.candidates.push({ ...f.candidates[0]!, observationKey: "second", location: opaque("B") });
      const preview = yield* f.app.admission.preview(f.request);
      expect(
        preview.candidates.every(
          (candidate) => candidate.conflict?.kind === "observation-location-identity"
        )
      ).toBe(true);
      for (const candidate of preview.candidates) {
        yield* assertFailure(
          f.app.admission.import({
            root: f.request.root,
            preview,
            selectedCandidateIds: [candidate.candidateId]
          }),
          /Conflicting/
        );
      }
      expect(f.writes).toBe(0);
    })
);
it.effect(
  "weak observations compare Locations and evidence changes still invalidate the reviewed selection",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      delete f.candidates[0]!.externalIdentities;
      const preview = yield* f.app.admission.preview(f.request);
      f.candidates[0]!.evidence[0]!.fingerprint = "changed";
      yield* assertFailure(
        f.app.admission.import({
          root: f.request.root,
          preview,
          selectedCandidateIds: [preview.candidates[0]!.candidateId]
        }),
        /stale/
      );
      expect(f.writes).toBe(0);
      const fresh = yield* f.app.admission.preview(f.request);
      yield* f.app.admission.import({
        root: f.request.root,
        preview: fresh,
        selectedCandidateIds: [fresh.candidates[0]!.candidateId]
      });
      f.candidates[0]!.observationKey = "a-new-observation-key";
      f.candidates[0]!.title = "a-new-title";
      const repeated = yield* f.app.admission.preview(f.request);
      expect(repeated.candidates[0]!.disposition).toBe("existing-installation");
    })
);

it.effect("strict preview input rejects duplicate selection IDs before a rescan or write", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    f.candidates.push({ ...f.candidates[0]!, observationKey: "second", location: opaque("B") });
    const preview = yield* f.app.admission.preview(f.request);
    const duplicate = {
      ...preview,
      candidates: preview.candidates.map((candidate) => ({
        ...candidate,
        candidateId: preview.candidates[0]!.candidateId
      }))
    };
    yield* assertFailure(
      f.app.admission.import({
        root: f.request.root,
        preview: duplicate,
        selectedCandidateIds: [preview.candidates[0]!.candidateId]
      }),
      /unique candidate IDs/
    );
    expect(f.writes).toBe(0);
  })
);
