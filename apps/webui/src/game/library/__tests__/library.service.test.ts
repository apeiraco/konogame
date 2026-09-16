import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { describe, expect } from "vitest";
import {
  ApiRequestError,
  DAEMON_HTTP,
  type DaemonHttpService
} from "../../../infrastructure/http/daemon-http.ts";
import { LibraryAvailability, LibraryLayout } from "../library.model.ts";
import { LIBRARY_SERVICE, provideLibrary } from "../library.service.ts";

function libraryLayer(http: DaemonHttpService) {
  return provideLibrary().pipe(Layer.provide(Layer.succeed(DAEMON_HTTP, http)));
}

function unavailableHttp(): DaemonHttpService {
  return { request: () => Effect.die("This test must not send an HTTP request") };
}

describe("library UI service", () => {
  it.effect("retains wall filters and return focus within each Workspace", () =>
    Effect.gen(function* () {
      const library = yield* LIBRARY_SERVICE;
      const first = library.wall("/synthetic/first");
      first.setQuery("moon");
      first.selectHost("host-a");
      first.selectSource("source-a");
      first.setAvailability(LibraryAvailability.Available);
      first.rememberGame("game-a");

      const second = library.wall("/synthetic/second");
      expect(second.filter.value).toEqual({
        query: "",
        hostId: "",
        sourceId: "",
        availability: LibraryAvailability.All
      });
      expect(second.returnFocusId.value).toBeUndefined();
      expect(library.wall("/synthetic/first")).toBe(first);
      expect(first.filter.value).toEqual({
        query: "moon",
        hostId: "host-a",
        sourceId: "source-a",
        availability: LibraryAvailability.Available
      });
      expect(first.returnFocusId.value).toBe("game-a");
    }).pipe(Effect.provide(libraryLayer(unavailableHttp())))
  );

  it.effect(
    "clears the dependent source when the Host changes and keeps filter values finite",
    () =>
      Effect.gen(function* () {
        const library = yield* LIBRARY_SERVICE;
        const wall = library.wall("/synthetic/workspace");
        wall.selectHost("host-a");
        wall.selectSource("source-a");
        const previous = wall.filter.value;
        wall.selectHost("host-b");
        expect(wall.filter.value.sourceId).toBe("");
        expect(previous).toMatchObject({ hostId: "host-a", sourceId: "source-a" });
        wall.setAvailability("unknown");
        expect(wall.filter.value.availability).toBe(LibraryAvailability.All);
      }).pipe(Effect.provide(libraryLayer(unavailableHttp())))
  );

  it.effect("consumes return focus once without clearing a newer game choice", () =>
    Effect.gen(function* () {
      const library = yield* LIBRARY_SERVICE;
      const wall = library.wall("/synthetic/workspace");
      wall.rememberGame("game-a");
      wall.rememberGame("game-b");
      wall.acknowledgeReturnFocus("game-a");
      expect(wall.returnFocusId.value).toBe("game-b");
      wall.acknowledgeReturnFocus("game-b");
      expect(wall.returnFocusId.value).toBeUndefined();
    }).pipe(Effect.provide(libraryLayer(unavailableHttp())))
  );

  it.effect("allocates independent state in separately provided service graphs", () => {
    const layer = libraryLayer(unavailableHttp());
    const read = Effect.gen(function* () {
      const library = yield* LIBRARY_SERVICE;
      return library.wall("/synthetic/workspace");
    }).pipe(Effect.provide(layer));
    return Effect.gen(function* () {
      const first = yield* read;
      first.setQuery("first browser");
      const second = yield* read;
      expect(second).not.toBe(first);
      expect(second.filter.value.query).toBe("");
    });
  });

  it.effect(
    "uses the injected HTTP boundary for encoded library/detail queries and preserves refusals",
    () => {
      const requested: string[] = [];
      const failure = new ApiRequestError(409, {
        error: { tag: "SyntheticWorkspaceRefusal", message: "Synthetic refusal" }
      });
      const http: DaemonHttpService = {
        request: (path) =>
          Effect.suspend(() => {
            requested.push(path);
            return Effect.fail(failure);
          })
      };
      return Effect.gen(function* () {
        const library = yield* LIBRARY_SERVICE;
        const listRequest = library.readLibrary("/synthetic/a b&c");
        expect(requested).toEqual([]);
        expect(yield* Effect.flip(listRequest)).toBe(failure);
        expect(yield* Effect.flip(library.readGame("/synthetic/a b&c", "game/with space"))).toBe(
          failure
        );
        const listUrl = new URL(requested[0]!, "http://localhost");
        const detailUrl = new URL(requested[1]!, "http://localhost");
        expect(listUrl.pathname).toBe("/api/games");
        expect(detailUrl.pathname).toBe("/api/games/game%2Fwith%20space");
        expect(listUrl.searchParams.get("root")).toBe("/synthetic/a b&c");
        expect(detailUrl.searchParams.get("root")).toBe("/synthetic/a b&c");
      }).pipe(Effect.provide(libraryLayer(http)));
    }
  );
});

describe("library reading preferences", () => {
  it.effect("shares the layout across Workspaces, keeps it finite and clears filters at once", () =>
    Effect.gen(function* () {
      const library = yield* LIBRARY_SERVICE;
      expect(library.layout.value).toBe(LibraryLayout.Wall);
      library.setLayout(LibraryLayout.List);
      expect(library.layout.value).toBe(LibraryLayout.List);
      library.setLayout("poster");
      expect(library.layout.value).toBe(LibraryLayout.Wall);

      const wall = library.wall("/synthetic/workspace");
      wall.setQuery("moon");
      wall.selectHost("host-a");
      wall.selectSource("source-a");
      wall.setAvailability(LibraryAvailability.Unverified);
      wall.rememberGame("game-a");
      wall.clearFilters();
      expect(wall.filter.value).toEqual({
        query: "",
        hostId: "",
        sourceId: "",
        availability: LibraryAvailability.All
      });
      // Clearing filters is not a navigation and keeps the pending return target.
      expect(wall.returnFocusId.value).toBe("game-a");
    }).pipe(Effect.provide(libraryLayer(unavailableHttp())))
  );
});
