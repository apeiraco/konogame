import { type WorkspaceBrowseService } from "@konogame/workspace/browse";
import { type WorkspaceManagementService } from "@konogame/workspace/management";
import { type Effect } from "effect";

export type WorkspaceInspection = Effect.Success<
  ReturnType<WorkspaceManagementService["inspectWorkspace"]>
>;
export type WorkspaceLocationListing = Effect.Success<ReturnType<WorkspaceBrowseService["list"]>>;
export type WorkspaceLocationProbe = Effect.Success<ReturnType<WorkspaceBrowseService["probe"]>>;
export type WorkspaceBrowseEntryView = WorkspaceLocationListing["entries"][number];
export type WorkspaceLocation = WorkspaceBrowseEntryView["location"];
