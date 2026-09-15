export const libraryKeys = {
  library: (root: string) => ["workspace", root, "library"] as const,
  game: (root: string, id: string) => ["workspace", root, "game", id] as const
};
