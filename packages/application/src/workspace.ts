import {
  resolveInstallationPath,
  resolveSettings,
  type Settings,
  settingsSchema,
  type WorkspaceSnapshot
} from "@konogame/workspace";

export interface WorkspaceSelection {
  hostId?: string;
  installationId?: string;
  overrides?: Settings;
  preferredAdapterId?: string;
}

export function inspectWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
  selection: WorkspaceSelection
) {
  const host = selection.hostId
    ? snapshot.hosts.find((item) => item.id === selection.hostId)
    : undefined;
  if (selection.hostId && !host) throw new Error(`Unknown host: ${selection.hostId}`);
  const installation = selection.installationId
    ? snapshot.installations.find((item) => item.id === selection.installationId)
    : undefined;
  if (selection.installationId && !installation)
    throw new Error(`Unknown installation: ${selection.installationId}`);
  if (installation && installation.hostId !== host?.id)
    throw new Error("Select the installation's host explicitly");
  const game = installation
    ? snapshot.games.find((item) => item.id === installation.gameId)
    : undefined;
  const effective = resolveSettings([
    {
      name: "built-in",
      settings: {
        preferredAdapters: { "save.store": "filesystem.save-store" },
        clear: { launchEntry: true },
        arguments: []
      }
    },
    { name: "workspace", settings: snapshot.workspace.defaults },
    { name: "game", settings: game?.settings ?? {} },
    { name: "host", settings: host?.defaults ?? {} },
    { name: "host-game", settings: (game && host?.gameOverrides[game.id]) || {} },
    { name: "installation", settings: installation?.settings ?? {} },
    { name: "invocation", settings: settingsSchema.parse(selection.overrides ?? {}) }
  ]);
  if (
    installation &&
    effective.values.launchEntry &&
    !installation.launchEntries.some((entry) => entry.id === effective.values.launchEntry)
  ) {
    throw new Error(`Unknown effective launch entry: ${effective.values.launchEntry}`);
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
    games: snapshot.games.map(({ id, uniformName, title }) => ({ id, uniformName, title })),
    installations: snapshot.installations.map((item) => ({
      id: item.id,
      uniformName: item.uniformName,
      gameId: item.gameId,
      hostId: item.hostId,
      sourceId: item.sourceId,
      location: item.location,
      resolvedPath: resolveInstallationPath(
        item,
        snapshot.hosts.find((host) => host.id === item.hostId)!
      )
    })),
    selection: { hostId: host?.id, gameId: game?.id, installationId: installation?.id },
    effective
  };
}
