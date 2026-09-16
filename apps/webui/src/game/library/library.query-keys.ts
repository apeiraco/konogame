export const libraryKeys = {
  library: (root: string, adapterId?: string) => ["workspace", root, "library", adapterId] as const,
  game: (root: string, id: string, adapterId?: string) =>
    ["workspace", root, "game", id, adapterId] as const
};
