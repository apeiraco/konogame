import {
  LocationResolutionStatus,
  LocationValidationStatus
} from "@konogame/infrastructure/contracts";
import { type GameView, type InstallationView } from "./library.read-model.ts";

export const LibraryAvailability = {
  All: "all",
  Available: "available",
  Unavailable: "unavailable",
  Unverified: "unverified",
  Uninstalled: "uninstalled"
} as const;
export type LibraryAvailability = (typeof LibraryAvailability)[keyof typeof LibraryAvailability];

/** Presentation density of the library; both layouts show the same games in the same order. */
export const LibraryLayout = { Wall: "wall", List: "list" } as const;
export type LibraryLayout = (typeof LibraryLayout)[keyof typeof LibraryLayout];

/** Display state derived from Location inspection; it never claims a launchable game. */
export const InstallationState = {
  Available: "available",
  Unavailable: "unavailable",
  Unverified: "unverified",
  None: "none"
} as const;
export type InstallationState = (typeof InstallationState)[keyof typeof InstallationState];

export interface LibraryFilter {
  query: string;
  hostId: string;
  sourceId: string;
  availability: LibraryAvailability;
}

type InstallationStatusView = Pick<InstallationView, "locationStatus">;

export function installationAvailable(installation: InstallationStatusView) {
  return installation.locationStatus.availability.status === LocationResolutionStatus.Resolved;
}

export function installationState(installation: InstallationStatusView): InstallationState {
  if (installationAvailable(installation)) {
    return InstallationState.Available;
  }
  // An unverified Location has an unknown type or schema and cannot be checked here.
  return installation.locationStatus.validation.status === LocationValidationStatus.Unverified
    ? InstallationState.Unverified
    : InstallationState.Unavailable;
}

/** Summarises a game's installations with the most useful state first. */
export function gameInstallationState(
  installations: readonly InstallationStatusView[]
): InstallationState {
  const states = new Set(installations.map(installationState));
  for (const state of [
    InstallationState.Available,
    InstallationState.Unverified,
    InstallationState.Unavailable
  ]) {
    if (states.has(state)) {
      return state;
    }
  }
  return InstallationState.None;
}

export function hasActiveFilter(filter: LibraryFilter) {
  return (
    filter.query.trim() !== "" ||
    filter.hostId !== "" ||
    filter.sourceId !== "" ||
    filter.availability !== LibraryAvailability.All
  );
}

/**
 * Installations inside the Host/source filter. Filtering and every card fact use this same
 * scope, so a card never reports a state taken from an installation the filter excluded.
 */
export function scopedInstallations<T extends Pick<InstallationView, "hostId" | "sourceId">>(
  installations: readonly T[],
  filter: Pick<LibraryFilter, "hostId" | "sourceId">
): T[] {
  return installations.filter(
    (item) =>
      (!filter.hostId || item.hostId === filter.hostId) &&
      (!filter.sourceId || item.sourceId === filter.sourceId)
  );
}

const availabilityState = {
  [LibraryAvailability.Available]: InstallationState.Available,
  [LibraryAvailability.Unavailable]: InstallationState.Unavailable,
  [LibraryAvailability.Unverified]: InstallationState.Unverified,
  [LibraryAvailability.Uninstalled]: InstallationState.None
} as const;

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
      const installations = scopedInstallations(game.installations, filter);
      if ((filter.hostId || filter.sourceId) && !installations.length) {
        return false;
      }
      return (
        filter.availability === LibraryAvailability.All ||
        gameInstallationState(installations) === availabilityState[filter.availability]
      );
    })
    .sort((a, b) => collator.compare(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// Curated ink hues keep generated covers legible in both colour schemes.
const coverHues = [12, 32, 48, 96, 152, 192, 222, 262, 300, 336] as const;
const coverMotifs = ["stripe", "grid", "arc", "band"] as const;
export type CoverMotif = (typeof coverMotifs)[number];

export interface GeneratedCoverStyle {
  readonly hue: number;
  readonly motif: CoverMotif;
  readonly glyph: string;
}

/** A deterministic generated placeholder; it is never presented as real cover art. */
export function generatedCover(id: string, title: string, locale?: string): GeneratedCoverStyle {
  let value = 0;
  for (const character of id) {
    value = (value * 31 + character.charCodeAt(0)) >>> 0;
  }
  const first = new Intl.Segmenter(locale, { granularity: "grapheme" })
    .segment(title.trim())
    [Symbol.iterator]()
    .next().value?.segment;
  return {
    hue: coverHues[value % coverHues.length]!,
    motif: coverMotifs[(value >>> 4) % coverMotifs.length]!,
    glyph: (first ?? "?").toLocaleUpperCase(locale)
  };
}
