import { Context, Effect, Layer } from "effect";
import {
  DAEMON_HTTP,
  type DaemonHttpService,
  rootQuery
} from "../infrastructure/http/daemon-http.ts";
import {
  type WorkspaceInspection,
  type WorkspaceLocation,
  type WorkspaceLocationListing,
  type WorkspaceLocationProbe
} from "./workspace.read-model.ts";

export class WorkspaceQueryService {
  constructor(private readonly http: DaemonHttpService) {}

  inspect(workspaceRoot: string, preferredAdapterId?: string) {
    return this.http.request<WorkspaceInspection>(
      `/api/workspace/inspect?${rootQuery(workspaceRoot, preferredAdapterId)}`
    );
  }

  /** Lists one level below a Location, or the daemon's starting points without one. */
  listLocations(location?: WorkspaceLocation) {
    return this.http.request<WorkspaceLocationListing>("/api/workspace/locations", {
      method: "POST",
      body: JSON.stringify(location ? { location } : {})
    });
  }

  probeLocation(location: WorkspaceLocation) {
    return this.http.request<WorkspaceLocationProbe>("/api/workspace/locations/probe", {
      method: "POST",
      body: JSON.stringify({ location })
    });
  }
}

export class WORKSPACE_QUERY extends Context.Service<WORKSPACE_QUERY, WorkspaceQueryService>()(
  "webui.workspace-query"
) {}

export function provideWorkspaceQuery() {
  return Layer.effect(
    WORKSPACE_QUERY,
    Effect.map(DAEMON_HTTP, (http) => new WorkspaceQueryService(http))
  );
}
