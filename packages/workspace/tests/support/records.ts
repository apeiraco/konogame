import { v7 as uuidv7 } from "uuid";
import {
  type GameRecord,
  HistoryMode,
  HostPlatform,
  type HostRecord,
  type InstallationRecord,
  LaunchKind,
  LocationKind,
  RecordKind,
  SourceStatus,
  WORKSPACE_SCHEMA,
  type WorkspaceRecord
} from "../../src/index.ts";

export function records() {
  const workspace: WorkspaceRecord = {
    kind: RecordKind.Workspace,
    schemaVersion: WORKSPACE_SCHEMA,
    id: uuidv7(),
    name: "Synthetic lab",
    defaults: { preferredAdapters: { "save.store": "workspace.store" } },
    history: { mode: HistoryMode.Disabled }
  };
  const game: GameRecord = {
    kind: RecordKind.Game,
    schemaVersion: WORKSPACE_SCHEMA,
    id: uuidv7(),
    uniformName: "Synthetic game",
    title: "Synthetic game",
    externalRefs: [{ authority: "example", kind: "product", key: { id: "sample" } }],
    settings: { arguments: ["game"], preferredAdapters: { "save.store": "game.store" } }
  };
  const host: HostRecord = {
    kind: RecordKind.Host,
    schemaVersion: WORKSPACE_SCHEMA,
    id: uuidv7(),
    uniformName: "Synthetic host",
    label: "Synthetic host",
    platform: HostPlatform.Windows,
    roots: { games: "D:/Games" },
    defaults: { arguments: ["host"] },
    gameOverrides: { [game.id]: { arguments: ["host-game"] } },
    sources: [{ id: "manual", kind: "manual", status: SourceStatus.Configured }]
  };
  const installation: InstallationRecord = {
    kind: RecordKind.Installation,
    schemaVersion: WORKSPACE_SCHEMA,
    id: uuidv7(),
    uniformName: "Main installation",
    gameId: game.id,
    hostId: host.id,
    sourceId: "manual",
    location: { kind: LocationKind.Relative, rootKey: "games", path: "Synthetic" },
    launchEntries: [
      {
        id: "play",
        label: "Play",
        kind: LaunchKind.Executable,
        target: "D:/Games/Synthetic/play.exe",
        arguments: []
      }
    ],
    settings: {
      arguments: [],
      launchEntry: "play",
      preferredAdapters: { "save.store": "installation.store" }
    }
  };
  return { workspace, game, host, installation };
}
