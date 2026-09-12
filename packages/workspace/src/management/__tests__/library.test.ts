import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type AdapterDescriptor,
  type AdapterResolutionPlan
} from "@konogame/infrastructure/contracts";
import { saveModule } from "@konogame/save";
import {
  WORKSPACE_SCHEMA,
  WorkspaceNotFoundError,
  WorkspaceResourceKind,
  type WorkspaceSnapshot,
  workspaceModule
} from "@konogame/workspace";
import { WorkspaceSelectionError, WorkspaceSelectionKind } from "@konogame/workspace/management";
import { Effect } from "effect";
import { expect } from "vitest";
import { assertFailure } from "../../../../../tests/support/assertions.ts";
import { createApplication } from "../../../../../tests/support/use-cases.ts";

const id = (suffix: number) => `019a0000-0000-7000-8000-${suffix.toString().padStart(12, "0")}`;
const descriptor: AdapterDescriptor = {
  id: "fixture.configuration",
  owner: { kind: "module", id: "konogame.workspace" },
  port: "workspace.configuration",
  declarationProtocolRange: "^0.2.0",
  portVersionRange: "^0.2.0",
  operations: ["read", "edit"],
  capabilities: ["configuration.records", "configuration.edit"]
};
function fixture() {
  return Effect.gen(function* () {
    const snapshot: WorkspaceSnapshot = {
      workspace: {
        kind: "workspace",
        schemaVersion: WORKSPACE_SCHEMA,
        id: id(1),
        name: "Library",
        defaults: { arguments: ["workspace"] },
        history: { mode: "disabled" }
      },
      games: [
        {
          kind: "game",
          schemaVersion: WORKSPACE_SCHEMA,
          id: id(2),
          uniformName: "Game",
          title: "Game title",
          externalRefs: [],
          settings: { arguments: ["game"] }
        }
      ],
      hosts: [
        {
          kind: "host",
          schemaVersion: WORKSPACE_SCHEMA,
          id: id(3),
          uniformName: "Host",
          label: "Host label",
          platform: "windows",
          roots: {},
          sources: [{ id: "standalone", kind: "standalone", status: "configured" as const }],
          defaults: { arguments: ["host"] },
          gameOverrides: { [id(2)]: { arguments: ["host-game"] } }
        }
      ],
      installations: [
        {
          kind: "installation",
          schemaVersion: WORKSPACE_SCHEMA,
          id: id(4),
          uniformName: "Local",
          gameId: id(2),
          hostId: id(3),
          sourceId: "standalone",
          location: { type: "unknown.location", schemaVersion: "9.0.0", data: { opaque: true } },
          launchEntries: [],
          settings: { arguments: [], clear: { preferredAdapters: ["save.store"] } }
        }
      ],
      revision: "revision"
    };
    const app = yield* createApplication(
      [workspaceModule, saveModule],
      [
        descriptor,
        {
          id: "fixture.store",
          owner: { kind: "extension", id: "fixture.store" },
          port: "save.store",
          declarationProtocolRange: "^0.2.0",
          portVersionRange: "^0.2.0",
          operations: ["put", "open"],
          capabilities: ["artifact.multifile", "artifact.streaming"]
        }
      ],
      new Map([
        [
          "fixture.store",
          {
            put() {
              return Effect.gen(function* () {
                return yield* Effect.die(new Error("Explain must not write Artifacts"));
              });
            },
            open() {
              return Effect.gen(function* () {
                return yield* Effect.die(new Error("Explain must not open Artifacts"));
              });
            }
          }
        ]
      ]),
      new Map([
        [
          descriptor.id,
          {
            read() {
              return Effect.sync(() => {
                return snapshot;
              });
            },
            edit(input) {
              return Effect.sync(() => {
                return { status: "unchanged" as const, operationId: input.operationId };
              });
            }
          }
        ]
      ])
    );
    return { app, snapshot };
  });
}
it.effect(
  "library query associates Host and source while preserving unavailable Locations and UUID identity",
  () =>
    Effect.gen(function* () {
      const { app, snapshot } = yield* fixture();
      const result = yield* app.workspace.listGames("synthetic");
      expect(result.games[0]?.id).toBe(id(2));
      expect(result.games[0]?.installations[0]?.host.label).toBe("Host label");
      expect(result.games[0]?.installations[0]?.source?.kind).toBe("standalone");
      expect(result.games[0]?.installations[0]?.location).toEqual(
        snapshot.installations[0]?.location
      );
      expect(result.games[0]?.installations[0]?.locationStatus.validation.status).toBe(
        "unverified"
      );
      expect(result.games[0]?.installations[0]?.locationStatus.availability.status).toBe(
        "unavailable"
      );
      expect((yield* app.workspace.showGame("synthetic", id(2))).game.title).toBe("Game title");
      const missing = yield* Effect.flip(app.workspace.showGame("synthetic", id(99)));
      assert.ok(missing instanceof WorkspaceNotFoundError);
      assert.equal(missing.resource, WorkspaceResourceKind.Game);
      assert.equal(missing.id, id(99));
      assert.match(missing.message, /Unknown game/);
      const required = yield* Effect.flip(
        app.workspace.listGames("synthetic", { sourceId: "standalone" })
      );
      assert.ok(required instanceof WorkspaceSelectionError);
      assert.deepEqual(required.issue, {
        kind: WorkspaceSelectionKind.HostRequired,
        sourceId: "standalone"
      });
      assert.match(required.message, /Select a Host/);
    })
);
it.effect(
  "unknown Installation Location does not become an operand for Artifact or metadata Features",
  () =>
    Effect.gen(function* () {
      const { app } = yield* fixture();
      const result = yield* app.workspace.explainSettings(
        "synthetic",
        { gameId: id(2), hostId: id(3), installationId: id(4) },
        ["save.store", "workspace.edit"]
      );
      expect(
        result.features.map(
          (feature) => resolutionPlanForFeature(feature)?.resolvedAdapters[0]?.adapterId
        )
      ).toEqual(["fixture.store", descriptor.id]);
      expect(result.locationStatus?.validation.status).toBe("unverified");
      expect(result.locationStatus?.availability.status).toBe("unavailable");
    })
);
it.effect(
  "effective explain shows all layers, clear origins, invocation and unavailable Adapter resolutions",
  () =>
    Effect.gen(function* () {
      const { app } = yield* fixture();
      const result = yield* app.workspace.explainSettings(
        "synthetic",
        {
          gameId: id(2),
          hostId: id(3),
          installationId: id(4),
          overrides: {
            arguments: ["invocation"],
            preferredAdapters: { "save.store": "missing.adapter" }
          }
        },
        ["save.store", "unknown.feature"]
      );
      expect(result.layers.map((layer) => layer.name)).toEqual([
        "built-in",
        "workspace",
        "game",
        "host",
        "host-game",
        "installation",
        "invocation"
      ]);
      expect(result.layers[0]?.settings.preferredAdapters).toBeUndefined();
      expect(result.layers[5]?.settings.clear?.preferredAdapters).toEqual(["save.store"]);
      expect(result.effective.values.arguments).toEqual(["invocation"]);
      expect(result.effective.origins.arguments).toBe("invocation");
      expect(resolutionPlanForFeature(result.features[0])?.unavailable[0]?.reason).toContain(
        "missing.adapter"
      );
      expect(result.locationStatus?.validation.status).toBe("unverified");
      const portable = yield* app.workspace.explainSettings("synthetic", {
        gameId: id(2),
        overrides: { preferredAdapters: { "save.store": "missing.adapter" } }
      });
      expect(resolutionPlanForFeature(portable.features[0])?.unavailable[0]?.reason).toContain(
        "missing.adapter"
      );
      expect(
        result.features[1] && "reason" in result.features[1] ? result.features[1].reason : undefined
      ).toContain("Unknown feature");
      expect(
        (yield* app.workspace.explainSettings("synthetic", { installationId: id(4) })).selection
      ).toEqual({
        installationId: id(4),
        hostId: id(3),
        gameId: id(2)
      });
      yield* assertFailure(
        app.workspace.explainSettings("synthetic", { installationId: id(4), hostId: id(99) }),
        "Unknown host"
      );
    })
);
function resolutionPlanForFeature(
  feature:
    | {
        adapterResolutionPlan: AdapterResolutionPlan;
      }
    | {
        reason: string;
      }
    | undefined
) {
  return feature && "adapterResolutionPlan" in feature ? feature.adapterResolutionPlan : undefined;
}

it.effect("Installation selection mismatches carry the selected and expected entity IDs", () =>
  Effect.gen(function* () {
    const { app, snapshot } = yield* fixture();
    const host = yield* Effect.flip(
      app.workspace.inspectWorkspace("synthetic", { installationId: id(4) })
    );
    assert.ok(host instanceof WorkspaceSelectionError);
    assert.deepEqual(host.issue, {
      kind: WorkspaceSelectionKind.InstallationHostMismatch,
      installationId: id(4),
      expectedHostId: id(3),
      selectedHostId: undefined
    });
    snapshot.games.push({ ...snapshot.games[0]!, id: id(5) });
    const game = yield* Effect.flip(
      app.workspace.inspectWorkspace("synthetic", {
        installationId: id(4),
        hostId: id(3),
        gameId: id(5)
      })
    );
    assert.ok(game instanceof WorkspaceSelectionError);
    assert.deepEqual(game.issue, {
      kind: WorkspaceSelectionKind.InstallationGameMismatch,
      installationId: id(4),
      expectedGameId: id(2),
      selectedGameId: id(5)
    });
  })
);
