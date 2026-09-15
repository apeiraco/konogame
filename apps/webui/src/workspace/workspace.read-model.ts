import { type WorkspaceManagementService } from "@konogame/workspace/management";
import { type Effect } from "effect";

export type WorkspaceInspection = Effect.Success<
  ReturnType<WorkspaceManagementService["inspectWorkspace"]>
>;
