import { type WorkspaceBrowseError } from "@konogame/workspace/contracts";
import { Effect } from "effect";

/** A browsing request is a value: absent path asks for the available starting points. */
export interface WorkspaceBrowseAccessRequest {
  readonly path?: string;
}

/** Controls browser reads only; it does not authorize discovery, probing, or opening a Workspace. */
export interface WorkspaceBrowseAccessPolicy {
  check(request: WorkspaceBrowseAccessRequest): Effect.Effect<void, WorkspaceBrowseError>;
}

/** Native process permissions decide access unless application composition supplies a policy. */
export class ProcessWorkspaceBrowseAccessPolicy implements WorkspaceBrowseAccessPolicy {
  check(_request: WorkspaceBrowseAccessRequest): Effect.Effect<void, WorkspaceBrowseError> {
    return Effect.void;
  }
}
