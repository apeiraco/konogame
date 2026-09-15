export const workspaceKeys = {
  workspace: (root: string) => ["workspace", root] as const,
  inspection: (root: string) => ["workspace", root, "inspection"] as const
};
