import { Context, Effect, Layer } from "effect";
import {
  DAEMON_HTTP,
  type DaemonHttpService,
  rootQuery
} from "../infrastructure/http/daemon-http.ts";
import { type WorkspaceInspection } from "./workspace.read-model.ts";

export class WorkspaceQueryService {
  constructor(private readonly http: DaemonHttpService) {}

  inspect(workspaceRoot: string) {
    return this.http.request<WorkspaceInspection>(
      `/api/workspace/inspect?${rootQuery(workspaceRoot)}`
    );
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
