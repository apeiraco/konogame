import { type LocationBehaviorService } from "@konogame/infrastructure";
import { Effect } from "effect";
import { WorkspaceNotFoundError, WorkspaceResourceKind } from "../model/errors.ts";
import { type Settings, type WorkspaceSnapshot } from "../model/records.ts";
import { assertSettings, resolveSettings } from "../model/settings.ts";
import { WorkspaceSelectionError, WorkspaceSelectionKind, workspaceRule } from "./errors.ts";

export interface WorkspaceSelection {
  gameId?: string;
  hostId?: string;
  installationId?: string;
  overrides?: Settings;
  preferredAdapterId?: string;
}

export function workspaceSettings(snapshot: WorkspaceSnapshot, selection: WorkspaceSelection) {
  const host = selection.hostId
    ? snapshot.hosts.find((item) => item.id === selection.hostId)
    : undefined;
  if (selection.hostId && !host) {
    throw new WorkspaceNotFoundError({
      resource: WorkspaceResourceKind.Host,
      id: selection.hostId,
      message: `Unknown host: ${selection.hostId}`
    });
  }
  const installation = selection.installationId
    ? snapshot.installations.find((item) => item.id === selection.installationId)
    : undefined;
  if (selection.installationId && !installation) {
    throw new WorkspaceNotFoundError({
      resource: WorkspaceResourceKind.Installation,
      id: selection.installationId,
      message: `Unknown installation: ${selection.installationId}`
    });
  }
  if (installation && installation.hostId !== host?.id) {
    throw new WorkspaceSelectionError({
      issue: {
        kind: WorkspaceSelectionKind.InstallationHostMismatch,
        installationId: installation.id,
        expectedHostId: installation.hostId,
        selectedHostId: host?.id
      },
      message: "Select the installation's host explicitly"
    });
  }
  const gameId = selection.gameId ?? installation?.gameId;
  const game = gameId ? snapshot.games.find((item) => item.id === gameId) : undefined;
  if (gameId && !game) {
    throw new WorkspaceNotFoundError({
      resource: WorkspaceResourceKind.Game,
      id: gameId,
      message: `Unknown game: ${gameId}`
    });
  }
  if (installation && installation.gameId !== game?.id) {
    throw new WorkspaceSelectionError({
      issue: {
        kind: WorkspaceSelectionKind.InstallationGameMismatch,
        installationId: installation.id,
        expectedGameId: installation.gameId,
        selectedGameId: game?.id
      },
      message: "Installation does not belong to the selected game"
    });
  }
  const layers = [
    {
      name: "built-in",
      settings: {
        clear: { launchEntry: true as const },
        arguments: []
      }
    },
    { name: "workspace", settings: snapshot.workspace.defaults },
    { name: "game", settings: game?.settings ?? {} },
    { name: "host", settings: host?.defaults ?? {} },
    {
      name: "host-game",
      settings: (game && host?.gameOverrides[game.id]) || {}
    },
    { name: "installation", settings: installation?.settings ?? {} },
    { name: "invocation", settings: assertSettings(selection.overrides ?? {}) }
  ];
  return {
    host,
    installation,
    game,
    layers,
    effective: resolveSettings(layers)
  };
}

export function inspectWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  selection: WorkspaceSelection,
  locations: LocationBehaviorService
) {
  return Effect.gen(function* () {
    const { host, installation, game, effective, layers } = yield* workspaceRule(
      "inspectWorkspaceSnapshot",
      (...values: Parameters<typeof workspaceSettings>) => workspaceSettings(...values),
      snapshot,
      selection
    );
    if (
      installation &&
      effective.values.launchEntry &&
      !installation.launchEntries.some((entry) => entry.id === effective.values.launchEntry)
    ) {
      return yield* Effect.fail(
        new WorkspaceNotFoundError({
          resource: WorkspaceResourceKind.LaunchEntry,
          id: effective.values.launchEntry,
          referringRecordId: installation.id,
          message: `Unknown effective launch entry: ${effective.values.launchEntry}`
        })
      );
    }
    return {
      workspace: { id: snapshot.workspace.id, name: snapshot.workspace.name },
      revision: snapshot.revision,
      diagnostics: snapshot.diagnostics ?? [],
      counts: {
        games: snapshot.games.length,
        hosts: snapshot.hosts.length,
        installations: snapshot.installations.length
      },
      hosts: snapshot.hosts.map(({ id, uniformName, label, platform, roots, sources }) => ({
        id,
        uniformName,
        label,
        platform,
        roots,
        sources
      })),
      games: snapshot.games.map(({ id, uniformName, title }) => ({
        id,
        uniformName,
        title
      })),
      installations: yield* Effect.all(
        snapshot.installations.map((item) =>
          Effect.gen(function* () {
            return {
              id: item.id,
              uniformName: item.uniformName,
              gameId: item.gameId,
              hostId: item.hostId,
              sourceId: item.sourceId,
              location: item.location,
              locationStatus: yield* locations.inspect(
                item.location,
                (() => {
                  const host = snapshot.hosts.find((host) => host.id === item.hostId)!;
                  return { platform: host.platform, roots: host.roots };
                })()
              )
            };
          })
        )
      ),
      selection: {
        hostId: host?.id,
        gameId: game?.id,
        installationId: installation?.id
      },
      effective,
      layers
    };
  });
}
