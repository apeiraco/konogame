import assert from "node:assert/strict";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { test } from "vitest";
import { records } from "../../../tests/support/records.ts";
import {
  applyConfigurationEdit,
  ConfigurationEditKind,
  configurationEditChangeSchema,
  HistoryMode,
  initializeConfigurationInputSchema,
  RecordKind,
  resolveSettings,
  SettingsTargetKind,
  SourceStatus,
  WorkspaceCapability,
  WorkspaceFeature,
  WorkspaceOperation,
  type WorkspaceSnapshot,
  workspaceConfigurationImplementation,
  workspaceModule
} from "../../index.ts";

function fixture(): WorkspaceSnapshot {
  const f = records();
  return {
    workspace: f.workspace,
    games: [f.game],
    hosts: [f.host],
    installations: [f.installation],
    revision: "revision"
  };
}

test("metadata projection replaces edition without changing entity identity or curated names", () => {
  const snapshot = fixture();
  const game = { ...snapshot.games[0], edition: "Old edition" };
  snapshot.games = [game];
  const plan = applyConfigurationEdit(snapshot, {
    kind: ConfigurationEditKind.MetadataReplace,
    target: { kind: RecordKind.Game, recordId: game.id },
    metadata: { title: "New title" }
  });
  assert.equal(plan.before, game);
  const { edition: _edition, ...unchanged } = game;
  assert.deepEqual(plan.after, { ...unchanged, title: "New title" });
  assert.equal(Object.hasOwn(plan.after, "edition"), false);
  assert.deepEqual(plan.differences, [
    { field: "title", before: game.title, after: "New title" },
    { field: "edition", before: "Old edition" }
  ]);
});

test("metadata plan preserves external identity and unknown Location resources", () => {
  const snapshot = fixture();
  const installation = snapshot.installations[0]!;
  installation.location = {
    type: "vendor.unavailable",
    schemaVersion: "7.0.0",
    data: { key: "opaque" }
  };
  const game = snapshot.games[0]!;
  const gamePlan = applyConfigurationEdit(snapshot, {
    kind: ConfigurationEditKind.MetadataReplace,
    target: { kind: RecordKind.Game, recordId: game.id },
    metadata: { title: "New title", edition: "New edition" }
  });
  assert.equal(gamePlan.after.id, game.id);
  assert.equal("uniformName" in gamePlan.after && gamePlan.after.uniformName, game.uniformName);
  assert.equal("externalRefs" in gamePlan.after && gamePlan.after.externalRefs, game.externalRefs);
  const settingsPlan = applyConfigurationEdit(snapshot, {
    kind: ConfigurationEditKind.SettingsReplace,
    target: { kind: SettingsTargetKind.Installation, recordId: installation.id },
    settings: {}
  });
  assert.equal(
    "location" in settingsPlan.after && settingsPlan.after.location,
    installation.location
  );
  assert.deepEqual(
    settingsPlan.differences.map((difference) => difference.field),
    ["settings"]
  );
  assert.deepEqual(installation.settings.arguments, []);
});

test("same metadata values produce an empty semantic difference", () => {
  const snapshot = fixture();
  assert.deepEqual(
    applyConfigurationEdit(snapshot, {
      kind: ConfigurationEditKind.MetadataReplace,
      target: { kind: RecordKind.Workspace, recordId: snapshot.workspace.id },
      metadata: { name: snapshot.workspace.name }
    }).differences,
    []
  );
});

test("all persistent settings layers replace completely and Host/Game omission restores inheritance", () => {
  const snapshot = fixture();
  const targets = [
    { kind: SettingsTargetKind.Workspace, recordId: snapshot.workspace.id },
    { kind: SettingsTargetKind.Game, recordId: snapshot.games[0]!.id },
    { kind: SettingsTargetKind.Host, recordId: snapshot.hosts[0]!.id },
    { kind: SettingsTargetKind.Installation, recordId: snapshot.installations[0]!.id }
  ];
  for (const target of targets) {
    const plan = applyConfigurationEdit(snapshot, {
      kind: ConfigurationEditKind.SettingsReplace,
      target,
      settings: {}
    });
    const layer =
      "defaults" in plan.after
        ? plan.after.defaults
        : "settings" in plan.after
          ? plan.after.settings
          : undefined;
    assert.deepEqual(layer, {});
    assert.equal(plan.differences.length, 1);
  }
  const host = snapshot.hosts[0]!;
  const game = snapshot.games[0]!;
  const plan = applyConfigurationEdit(snapshot, {
    kind: ConfigurationEditKind.SettingsReplace,
    target: { kind: SettingsTargetKind.HostGame, recordId: host.id, gameId: game.id },
    settings: {}
  });
  assert.deepEqual("gameOverrides" in plan.after && plan.after.gameOverrides, {});
  assert.deepEqual(host.gameOverrides[game.id], { arguments: ["host-game"] });
});

test("settings replacement preserves distinct inherit, clear, and empty array outcomes", () => {
  const inherited = { launchEntry: "play", arguments: ["inherited"] };
  assert.deepEqual(
    resolveSettings([
      { name: "low", settings: inherited },
      { name: "high", settings: {} }
    ]).values,
    inherited
  );
  assert.deepEqual(
    resolveSettings([
      { name: "low", settings: inherited },
      { name: "high", settings: { clear: { launchEntry: true }, arguments: [] } }
    ]).values,
    { launchEntry: null, arguments: [] }
  );
});

test("Host creation is one new UUID entity and duplicate UUIDs are rejected", () => {
  const snapshot = fixture();
  const host = { ...snapshot.hosts[0]!, id: uuidv7(), gameOverrides: {} };
  const plan = applyConfigurationEdit(snapshot, { kind: ConfigurationEditKind.HostCreate, host });
  assert.equal(plan.before, undefined);
  assert.equal(plan.after, host);
  assert.equal(snapshot.hosts.length, 1);
  assert.throws(
    () =>
      applyConfigurationEdit(snapshot, {
        kind: ConfigurationEditKind.HostCreate,
        host: { ...host, id: snapshot.games[0]!.id }
      }),
    /Duplicate record/
  );
});

test("source maintenance preserves referenced source identity and exposes planned availability", () => {
  const snapshot = fixture();
  const host = snapshot.hosts[0]!;
  assert.throws(
    () =>
      applyConfigurationEdit(snapshot, {
        kind: ConfigurationEditKind.HostSourcesReplace,
        hostId: host.id,
        sources: []
      }),
    /Unknown source/
  );
  assert.throws(
    () =>
      applyConfigurationEdit(snapshot, {
        kind: ConfigurationEditKind.HostSourcesReplace,
        hostId: host.id,
        sources: [{ ...host.sources[0]!, kind: "other" }]
      }),
    /referenced source/
  );
  const plan = applyConfigurationEdit(snapshot, {
    kind: ConfigurationEditKind.HostSourcesReplace,
    hostId: host.id,
    sources: [{ ...host.sources[0]!, status: SourceStatus.Planned }]
  });
  assert.equal("sources" in plan.after && plan.after.sources[0]!.status, SourceStatus.Planned);
  assert.throws(
    () =>
      applyConfigurationEdit(snapshot, {
        kind: ConfigurationEditKind.HostSourcesReplace,
        hostId: host.id,
        sources: [host.sources[0]!, host.sources[0]!]
      }),
    /Duplicate source/
  );
});

test("root aliases remain opaque adapter context and unrelated Host fields survive", () => {
  const snapshot = fixture();
  const host = snapshot.hosts[0]!;
  const plan = applyConfigurationEdit(snapshot, {
    kind: ConfigurationEditKind.HostRootsReplace,
    hostId: host.id,
    roots: { external: "opaque absolute alias for adapter" }
  });
  assert.equal("sources" in plan.after && plan.after.sources, host.sources);
  assert.equal("gameOverrides" in plan.after && plan.after.gameOverrides, host.gameOverrides);
  assert.deepEqual(
    plan.differences.map((difference) => difference.field),
    ["roots"]
  );
});

test("strict edit intents reject arbitrary patches, identity changes and mismatched metadata", () => {
  const snapshot = fixture();
  for (const change of [
    { kind: "patch", path: "workspace.toml", content: "bad" },
    {
      kind: ConfigurationEditKind.MetadataReplace,
      target: { kind: RecordKind.Game, recordId: snapshot.games[0]!.id },
      metadata: { title: "Title", uniformName: "rename" }
    },
    {
      kind: ConfigurationEditKind.MetadataReplace,
      target: { kind: RecordKind.Game, recordId: snapshot.games[0]!.id },
      metadata: { title: "Title", edition: null }
    },
    {
      kind: ConfigurationEditKind.SettingsReplace,
      target: { kind: SettingsTargetKind.HostGame, recordId: snapshot.hosts[0]!.id },
      settings: {}
    },
    {
      kind: ConfigurationEditKind.HostRootsReplace,
      hostId: snapshot.hosts[0]!.id,
      roots: {},
      extra: true
    }
  ]) {
    assert.throws(() => configurationEditChangeSchema.assert(change));
  }
  assert.throws(
    () =>
      applyConfigurationEdit(snapshot, {
        kind: ConfigurationEditKind.MetadataReplace,
        target: { kind: RecordKind.Host, recordId: snapshot.games[0]!.id },
        metadata: { label: "Wrong" }
      }),
    /target kind/
  );
  assert.throws(
    () =>
      applyConfigurationEdit(snapshot, {
        kind: ConfigurationEditKind.SettingsReplace,
        target: {
          kind: SettingsTargetKind.HostGame,
          recordId: snapshot.hosts[0]!.id,
          gameId: uuidv7()
        },
        settings: {}
      }),
    /Unknown game/
  );
});

test("initialization restricts history and starts with distinct Workspace and current Host", () => {
  const f = records();
  const input = {
    root: "synthetic-root",
    operationId: uuidv7(),
    workspace: { ...f.workspace, defaults: {}, history: { mode: HistoryMode.Disabled } },
    host: { ...f.host, defaults: {}, gameOverrides: {} }
  };
  assert.equal(initializeConfigurationInputSchema.assert(input), input);
  assert.throws(() =>
    initializeConfigurationInputSchema.assert({
      ...input,
      host: { ...input.host, id: input.workspace.id }
    })
  );
  assert.throws(() =>
    initializeConfigurationInputSchema.assert({
      ...input,
      workspace: {
        ...input.workspace,
        history: { mode: HistoryMode.Adapter, adapterId: "history" }
      }
    })
  );
  assert.throws(() => initializeConfigurationInputSchema.assert({ ...input, host: f.host }));
  assert.throws(() =>
    initializeConfigurationInputSchema.assert({
      ...input,
      host: { ...input.host, sources: [input.host.sources[0]!, input.host.sources[0]!] }
    })
  );
});

test("management operations require explicit capabilities while a read-only implementation remains valid", () => {
  assert.equal(
    workspaceConfigurationImplementation.is({ read: () => Effect.succeed(fixture()) }),
    true
  );
  const expected = [
    [WorkspaceFeature.Initialize, WorkspaceOperation.Initialize, WorkspaceCapability.Initialize],
    [
      WorkspaceFeature.RecoverInitialize,
      WorkspaceOperation.RecoverInitialize,
      WorkspaceCapability.InitializeRecovery
    ],
    [WorkspaceFeature.Edit, WorkspaceOperation.Edit, WorkspaceCapability.Edit],
    [WorkspaceFeature.RecoverEdit, WorkspaceOperation.RecoverEdit, WorkspaceCapability.EditRecovery]
  ];
  for (const [id, operation, capability] of expected) {
    const feature = workspaceModule.features.find((value) => value.id === id)!;
    assert.equal(feature.operation, operation);
    assert.deepEqual(feature.requiredCapabilities, [capability]);
  }
});
