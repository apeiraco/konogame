import { LocationResolutionStatus } from "@konogame/infrastructure/contracts";
import { type GameView, type InstallationView } from "./library.read-model.ts";

export const LibraryAvailability = {
  All: "all",
  Available: "available",
  Unavailable: "unavailable",
  Uninstalled: "uninstalled"
} as const;
export type LibraryAvailability = (typeof LibraryAvailability)[keyof typeof LibraryAvailability];

export interface LibraryFilter {
  query: string;
  hostId: string;
  sourceId: string;
  availability: LibraryAvailability;
}

export function installationAvailable(installation: InstallationView) {
  return installation.locationStatus.availability.status === LocationResolutionStatus.Resolved;
}

export function filterGames<
  T extends Pick<GameView, "id" | "title" | "edition" | "uniformName" | "installations">
>(games: T[], filter: LibraryFilter, locale?: string) {
  const query = filter.query.trim().toLocaleLowerCase(locale);
  const collator = new Intl.Collator(locale);
  return games
    .filter((game) => {
      if (
        query &&
        !`${game.title} ${game.edition ?? ""} ${game.uniformName}`
          .toLocaleLowerCase(locale)
          .includes(query)
      ) {
        return false;
      }
      const installations = game.installations.filter(
        (item) =>
          (!filter.hostId || item.hostId === filter.hostId) &&
          (!filter.sourceId || item.sourceId === filter.sourceId)
      );
      if ((filter.hostId || filter.sourceId) && !installations.length) {
        return false;
      }
      if (filter.availability === LibraryAvailability.Uninstalled) {
        return !installations.length;
      }
      if (filter.availability === LibraryAvailability.Available) {
        return installations.some(installationAvailable);
      }
      if (filter.availability === LibraryAvailability.Unavailable) {
        return installations.length > 0 && !installations.some(installationAvailable);
      }
      return true;
    })
    .sort((a, b) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function coverPalette(id: string) {
  let value = 0;
  for (const character of id) {
    value = (value * 31 + character.charCodeAt(0)) >>> 0;
  }
  return {
    background: `linear-gradient(145deg, hsl(${value % 360} 35% 25%), hsl(${(value + 60) % 360} 24% 12%))`
  };
}
