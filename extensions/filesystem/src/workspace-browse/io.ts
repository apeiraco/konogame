import { access, opendir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  WORKSPACE_BROWSE_LIMIT,
  WorkspaceBrowseError,
  WorkspaceBrowseFailureKind
} from "@konogame/workspace/contracts";
import { Effect } from "effect";

export interface BrowseStartingPoint {
  readonly path: string;
  readonly label: string;
}

export interface BrowseDirectoryEntry {
  readonly name: string;
  readonly path: string;
}

export interface BrowseDirectoryListing {
  readonly entries: readonly BrowseDirectoryEntry[];
  readonly complete: boolean;
}

/** Native I/O seam for Workspace browsing; tests replace it or use a real directory. */
export interface WorkspaceBrowseFileSystem {
  startingPoints(): Effect.Effect<readonly BrowseStartingPoint[]>;
  /** Direct child containers only. It never inspects grandchildren or file contents. */
  listDirectories(
    path: string,
    limit: number
  ): Effect.Effect<BrowseDirectoryListing, WorkspaceBrowseError>;
}

const failureKinds: Readonly<Record<string, WorkspaceBrowseFailureKind>> = {
  EACCES: WorkspaceBrowseFailureKind.Denied,
  EPERM: WorkspaceBrowseFailureKind.Denied,
  ENOENT: WorkspaceBrowseFailureKind.Missing,
  ENOTDIR: WorkspaceBrowseFailureKind.Missing
};

export function workspaceBrowseFailure(path: string, cause: unknown) {
  const code =
    cause !== null && typeof cause === "object" && "code" in cause && typeof cause.code === "string"
      ? cause.code
      : undefined;
  return new WorkspaceBrowseError({
    issue: {
      kind: (code && failureKinds[code]) || WorkspaceBrowseFailureKind.Failed,
      ...(code ? { code } : {})
    },
    message: `Cannot list ${path}${code ? ` (${code})` : ""}`,
    cause
  });
}

const driveLetters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
/** Bounds all examined entries, including files omitted from a directory listing. */
export const WORKSPACE_BROWSE_SCAN_LIMIT = WORKSPACE_BROWSE_LIMIT.Maximum;

const browseIO = <A>(path: string, read: () => Promise<A>) =>
  Effect.tryPromise({ try: read, catch: (cause) => workspaceBrowseFailure(path, cause) });

export class NodeWorkspaceBrowseFileSystem implements WorkspaceBrowseFileSystem {
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  startingPoints(): Effect.Effect<readonly BrowseStartingPoint[]> {
    const home = { path: homedir(), label: homedir() };
    if (this.platform !== "win32") {
      return Effect.succeed([home, { path: "/", label: "/" }]);
    }
    // Probe each drive root once; an absent or unready drive is simply not offered.
    return Effect.forEach(
      driveLetters,
      (letter) =>
        Effect.promise(() =>
          access(`${letter}:\\`).then(
            () => `${letter}:\\`,
            () => undefined
          )
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((drives) => [
        home,
        ...drives
          .filter((drive): drive is string => drive !== undefined)
          .map((drive) => ({ path: drive, label: drive }))
      ])
    );
  }

  listDirectories(path: string, limit: number) {
    return Effect.acquireUseRelease(
      browseIO(path, () => opendir(path, { bufferSize: 128 })),
      (directory) =>
        Effect.gen(function* () {
          const entries: BrowseDirectoryEntry[] = [];
          let examined = 0;
          while (true) {
            const entry = yield* browseIO(path, () => directory.read());
            if (!entry) {
              return { entries, complete: true };
            }
            // A directory full of files must stop too. One lookahead distinguishes exhaustion.
            if (examined === WORKSPACE_BROWSE_SCAN_LIMIT) {
              return { entries, complete: false };
            }
            examined++;
            // Junctions and directory links report as symbolic links; offering them costs no stat.
            if (!entry.isDirectory() && !entry.isSymbolicLink()) {
              continue;
            }
            if (entries.length === limit) {
              return { entries, complete: false };
            }
            entries.push({ name: entry.name, path: join(path, entry.name) });
          }
        }),
      (directory) => browseIO(path, () => directory.close())
    );
  }
}
