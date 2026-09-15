import { type WorkspaceManagementService } from "@konogame/workspace/management";
import { type Effect } from "effect";

export type Library = Effect.Success<ReturnType<WorkspaceManagementService["listGames"]>>;
export type GameDetail = Effect.Success<ReturnType<WorkspaceManagementService["showGame"]>>;
export type GameView = Library["games"][number];
export type InstallationView = GameView["installations"][number];
