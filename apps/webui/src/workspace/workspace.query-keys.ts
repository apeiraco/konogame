export const workspaceKeys = {
  workspace: (root: string) => ["workspace", root] as const,
  inspection: (root: string, adapterId?: string) =>
    ["workspace", root, "inspection", adapterId] as const,
  // Browsing happens before a Workspace is open, so its keys are not scoped to a root.
  locations: (locationKey: string) => ["workspace-locations", locationKey] as const,
  probe: (locationKey: string) => ["workspace-locations", locationKey, "probe"] as const
};
