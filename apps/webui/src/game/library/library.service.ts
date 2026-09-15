import { type ReadonlySignal, signal } from "@preact/signals-core";
import { Context, Effect, Layer } from "effect";
import {
  DAEMON_HTTP,
  type DaemonHttpService,
  rootQuery
} from "../../infrastructure/http/daemon-http.ts";
import { LibraryAvailability, type LibraryFilter } from "./library.model.ts";
import { type GameDetail, type Library } from "./library.read-model.ts";

export class LibraryWallState {
  private readonly currentFilter = signal<Readonly<LibraryFilter>>({
    query: "",
    hostId: "",
    sourceId: "",
    availability: LibraryAvailability.All
  });
  private readonly currentReturnFocusId = signal<string | undefined>(undefined);

  readonly filter: ReadonlySignal<Readonly<LibraryFilter>> = this.currentFilter;
  readonly returnFocusId: ReadonlySignal<string | undefined> = this.currentReturnFocusId;

  setQuery(query: string) {
    this.currentFilter.value = { ...this.currentFilter.peek(), query };
  }

  selectHost(hostId: string) {
    this.currentFilter.value = { ...this.currentFilter.peek(), hostId, sourceId: "" };
  }

  selectSource(sourceId: string) {
    this.currentFilter.value = { ...this.currentFilter.peek(), sourceId };
  }

  setAvailability(value: string | null) {
    const availability =
      Object.values(LibraryAvailability).find((item) => item === value) ?? LibraryAvailability.All;
    this.currentFilter.value = { ...this.currentFilter.peek(), availability };
  }

  rememberGame(gameId: string) {
    this.currentReturnFocusId.value = gameId;
  }

  acknowledgeReturnFocus(gameId: string) {
    if (this.currentReturnFocusId.peek() === gameId) {
      this.currentReturnFocusId.value = undefined;
    }
  }
}

export class LibraryService {
  private readonly walls = new Map<string, LibraryWallState>();

  constructor(private readonly http: DaemonHttpService) {}

  wall(workspaceRoot: string): LibraryWallState {
    let state = this.walls.get(workspaceRoot);
    if (!state) {
      state = new LibraryWallState();
      this.walls.set(workspaceRoot, state);
    }
    return state;
  }

  readLibrary(workspaceRoot: string) {
    return this.http.request<Library>(`/api/games?${rootQuery(workspaceRoot)}`);
  }

  readGame(workspaceRoot: string, gameId: string) {
    return this.http.request<GameDetail>(
      `/api/games/${encodeURIComponent(gameId)}?${rootQuery(workspaceRoot)}`
    );
  }
}

export class LIBRARY_SERVICE extends Context.Service<LIBRARY_SERVICE, LibraryService>()(
  "webui.library"
) {}

export function provideLibrary() {
  return Layer.effect(
    LIBRARY_SERVICE,
    Effect.map(DAEMON_HTTP, (http) => new LibraryService(http))
  );
}
