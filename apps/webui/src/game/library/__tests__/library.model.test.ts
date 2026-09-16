import {
  DECLARATION_PROTOCOL_VERSION,
  LocationResolutionStatus,
  LocationValidationStatus
} from "@konogame/infrastructure/contracts";
import {
  HostPlatform,
  RecordKind,
  SourceStatus,
  WORKSPACE_SCHEMA
} from "@konogame/workspace/contracts";
import { describe, expect, it } from "vitest";
import {
  filterGames,
  gameInstallationState,
  generatedCover,
  hasActiveFilter,
  InstallationState,
  installationState,
  LibraryAvailability,
  type LibraryFilter,
  scopedInstallations
} from "../library.model.ts";
import { type GameView, type InstallationView } from "../library.read-model.ts";

function installation(hostId: string, sourceId: string, available: boolean): InstallationView {
  const plan = {
    declarationProtocolVersion: DECLARATION_PROTOCOL_VERSION,
    resolvedAdapters: [],
    unavailable: []
  };
  return {
    kind: RecordKind.Installation,
    schemaVersion: WORKSPACE_SCHEMA,
    id: `${hostId}-${sourceId}`,
    uniformName: "Synthetic installation",
    gameId: "synthetic-game",
    hostId,
    sourceId,
    location: { type: "synthetic.location", schemaVersion: "1.0.0", data: {} },
    launchEntries: [],
    settings: {},
    host: { id: hostId, uniformName: hostId, label: hostId, platform: HostPlatform.Windows },
    source: { id: sourceId, kind: "synthetic", status: SourceStatus.Configured },
    locationStatus: {
      validation: { status: LocationValidationStatus.Valid },
      availability: available
        ? {
            status: LocationResolutionStatus.Resolved,
            resource: { type: "synthetic.resource", schemaVersion: "1.0.0", data: {} }
          }
        : {
            status: LocationResolutionStatus.Unavailable,
            reason: "Synthetic unavailable location"
          },
      adapterResolutionPlan: plan
    }
  };
}

const game: GameView = {
  id: "019a0000-0000-7000-8000-000000000001",
  schemaVersion: WORKSPACE_SCHEMA,
  kind: RecordKind.Game,
  title: "Synthetic Moon",
  edition: "Collector Edition",
  uniformName: "synthetic-moon",
  externalRefs: [],
  settings: {},
  installations: [
    installation("host-a", "standalone", false),
    installation("host-b", "steam", true)
  ]
};
const baseFilter: LibraryFilter = {
  query: "",
  hostId: "",
  sourceId: "",
  availability: LibraryAvailability.All
};

describe("library filters", () => {
  it("sorts titles using the interface locale and keeps ID ordering stable for equal titles", () => {
    const chinese = { ...game, title: "阿尔法" };
    const latin = { ...game, id: "019a0000-0000-7000-8000-000000000002", title: "Beta" };
    const equalTitle = { ...latin, id: "019a0000-0000-7000-8000-000000000003" };
    const games = [equalTitle, chinese, latin];
    expect(filterGames(games, baseFilter, "en")).toEqual([latin, equalTitle, chinese]);
    expect(filterGames(games, baseFilter, "zh-CN")).toEqual([chinese, latin, equalTitle]);
    expect(games).toEqual([equalTitle, chinese, latin]);
  });

  it("applies Host, source and availability to the same Installation", () => {
    expect(filterGames([game], { ...baseFilter, hostId: "host-a", sourceId: "steam" })).toEqual([]);
    expect(
      filterGames([game], {
        ...baseFilter,
        hostId: "host-a",
        availability: LibraryAvailability.Available
      })
    ).toEqual([]);
    expect(
      filterGames([game], {
        ...baseFilter,
        hostId: "host-a",
        availability: LibraryAvailability.Unavailable
      })
    ).toEqual([game]);
    expect(
      filterGames([game], { ...baseFilter, availability: LibraryAvailability.Available })
    ).toEqual([game]);
  });

  it("distinguishes an unavailable Installation from an uninstalled Game", () => {
    const uninstalled = { ...game, id: "019a0000-0000-7000-8000-000000000002", installations: [] };
    expect(
      filterGames([game, uninstalled], {
        ...baseFilter,
        availability: LibraryAvailability.Uninstalled
      })
    ).toEqual([uninstalled]);
    expect(
      filterGames([game], { ...baseFilter, availability: LibraryAvailability.Unavailable })
    ).toEqual([]);
  });

  it("searches title, edition and original name without mutating library order", () => {
    const earlier = { ...game, id: "019a0000-0000-7000-8000-000000000003", title: "Another Game" };
    const library = [game, earlier];
    expect(filterGames(library, baseFilter)).toEqual([earlier, game]);
    expect(library).toEqual([game, earlier]);
    expect(filterGames([game], { ...baseFilter, query: "  COLLECTOR  " })).toEqual([game]);
    expect(filterGames([game], { ...baseFilter, query: "synthetic-moon" })).toEqual([game]);
  });
});

function unverified(hostId: string): InstallationView {
  const base = installation(hostId, "standalone", false);
  return {
    ...base,
    id: `${hostId}-unverified`,
    location: { type: "synthetic.unknown", schemaVersion: "9.0.0", data: {} },
    locationStatus: {
      ...base.locationStatus,
      validation: {
        status: LocationValidationStatus.Unverified,
        reason: "Unknown synthetic type"
      }
    }
  };
}

describe("installation display state", () => {
  it("prefers an available installation, then an unverified one, before unavailable", () => {
    const available = installation("host-a", "steam", true);
    const unavailable = installation("host-a", "standalone", false);
    expect(installationState(available)).toBe(InstallationState.Available);
    expect(installationState(unavailable)).toBe(InstallationState.Unavailable);
    expect(installationState(unverified("host-a"))).toBe(InstallationState.Unverified);
    expect(gameInstallationState([])).toBe(InstallationState.None);
    expect(gameInstallationState([unavailable, unverified("host-a")])).toBe(
      InstallationState.Unverified
    );
    expect(gameInstallationState([unverified("host-a"), unavailable, available])).toBe(
      InstallationState.Available
    );
  });

  it("filters unverified locations separately from unavailable ones", () => {
    const unknownGame = {
      ...game,
      id: "019a0000-0000-7000-8000-000000000004",
      installations: [unverified("host-a")]
    };
    const unavailableGame = {
      ...game,
      id: "019a0000-0000-7000-8000-000000000005",
      installations: [installation("host-a", "standalone", false)]
    };
    expect(
      filterGames([unknownGame, unavailableGame], {
        ...baseFilter,
        availability: LibraryAvailability.Unverified
      })
    ).toEqual([unknownGame]);
    expect(
      filterGames([unknownGame, unavailableGame], {
        ...baseFilter,
        availability: LibraryAvailability.Unavailable
      })
    ).toEqual([unavailableGame]);
  });

  it("reports whether any filter narrows the library", () => {
    expect(hasActiveFilter(baseFilter)).toBe(false);
    expect(hasActiveFilter({ ...baseFilter, query: "   " })).toBe(false);
    expect(hasActiveFilter({ ...baseFilter, query: "moon" })).toBe(true);
    expect(hasActiveFilter({ ...baseFilter, availability: LibraryAvailability.Uninstalled })).toBe(
      true
    );
  });
});

describe("generated cover", () => {
  it("derives a stable style from the Game ID and the first grapheme of the title", () => {
    const first = generatedCover(game.id, "  synthetic Moon", "en");
    expect(generatedCover(game.id, "  synthetic Moon", "en")).toEqual(first);
    expect(first.glyph).toBe("S");
    expect(generatedCover(game.id, "👩‍🚀 Voyage").glyph).toBe("👩‍🚀");
    expect(generatedCover(game.id, "月の庭").glyph).toBe("月");
    expect(generatedCover(game.id, "").glyph).toBe("?");
  });
});

describe("filter-scoped card state", () => {
  it("reports the state of the installations the Host filter admitted, and the global state without it", () => {
    // The shared game has host-a unavailable and host-b available.
    const hostA = { ...baseFilter, hostId: "host-a" };
    const unavailableOnA = filterGames([game], {
      ...hostA,
      availability: LibraryAvailability.Unavailable
    });
    expect(unavailableOnA).toEqual([game]);
    expect(gameInstallationState(scopedInstallations(game.installations, hostA))).toBe(
      InstallationState.Unavailable
    );
    expect(scopedInstallations(game.installations, hostA)).toHaveLength(1);
    expect(
      gameInstallationState(
        scopedInstallations(game.installations, { ...baseFilter, hostId: "host-b" })
      )
    ).toBe(InstallationState.Available);
    expect(gameInstallationState(scopedInstallations(game.installations, baseFilter))).toBe(
      InstallationState.Available
    );
    expect(
      scopedInstallations(game.installations, {
        ...baseFilter,
        hostId: "host-b",
        sourceId: "standalone"
      })
    ).toEqual([]);
  });
});
