import {
  type LocationContract,
  LocationResolutionStatus
} from "@konogame/infrastructure/contracts";
import {
  WORKSPACE_BROWSE_LIMIT,
  type WorkspaceBrowseEntry,
  WorkspaceBrowseError,
  WorkspaceBrowseFailureKind,
  type WorkspaceBrowseListing,
  type WorkspaceLocationBrowserPort
} from "@konogame/workspace/contracts";
import { type } from "arktype";
import { Effect } from "effect";
import { FilesystemLocationBehavior } from "../location/behavior.ts";
import { absoluteFilesystemLocation, FilesystemLocationType } from "../location/values.ts";
import { type WorkspaceBrowseFileSystem } from "./io.ts";
import { ProcessWorkspaceBrowseAccessPolicy, type WorkspaceBrowseAccessPolicy } from "./policy.ts";

const absoluteData = type({ "+": "reject", path: "string > 0" });

/** Lists local directories as `fs.absolute` Locations for choosing a Workspace root. */
export class FilesystemWorkspaceLocationBrowser implements WorkspaceLocationBrowserPort {
  private readonly collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  private readonly locations = new FilesystemLocationBehavior();

  constructor(
    private readonly fileSystem: WorkspaceBrowseFileSystem,
    private readonly accessPolicy: WorkspaceBrowseAccessPolicy = new ProcessWorkspaceBrowseAccessPolicy()
  ) {}

  list(input: {
    readonly location?: LocationContract;
    readonly limit: number;
  }): Effect.Effect<WorkspaceBrowseListing, WorkspaceBrowseError> {
    return Effect.gen({ self: this }, function* () {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > WORKSPACE_BROWSE_LIMIT.Maximum
      ) {
        return yield* Effect.fail(
          new WorkspaceBrowseError({
            issue: { kind: WorkspaceBrowseFailureKind.Unsupported },
            message: "Workspace browse limit must be a bounded positive integer"
          })
        );
      }
      const { location } = input;
      if (!location) {
        yield* this.accessPolicy.check({});
        const points = yield* this.fileSystem.startingPoints();
        return {
          entries: points.slice(0, input.limit).map((point) => ({
            location: absoluteFilesystemLocation(point.path),
            label: point.label,
            canBrowse: true
          })),
          complete: points.length <= input.limit
        };
      }
      if (location.type !== FilesystemLocationType.Absolute) {
        return yield* Effect.fail(this.unsupported(location));
      }
      // Use the Location owner's path rules, including Windows drive and UNC validation.
      const resolution = yield* this.locations.resolve({ location }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceBrowseError({
              issue: { kind: WorkspaceBrowseFailureKind.Failed },
              message: "Cannot resolve the filesystem browse Location",
              cause
            })
        )
      );
      if (resolution.status !== LocationResolutionStatus.Resolved) {
        return yield* Effect.fail(this.unsupported(location));
      }
      const data = absoluteData(resolution.resource.data);
      if (data instanceof type.errors) {
        return yield* Effect.fail(this.unsupported(location));
      }
      yield* this.accessPolicy.check({ path: data.path });
      const { entries, complete } = yield* this.fileSystem.listDirectories(data.path, input.limit);
      return {
        entries: entries
          .map(
            (entry): WorkspaceBrowseEntry => ({
              location: absoluteFilesystemLocation(entry.path),
              label: entry.name,
              canBrowse: true
            })
          )
          .sort((left, right) => this.collator.compare(left.label, right.label)),
        complete
      };
    });
  }

  private unsupported(location: LocationContract) {
    return new WorkspaceBrowseError({
      issue: { kind: WorkspaceBrowseFailureKind.Unsupported },
      message: `Cannot browse Location ${location.type}@${location.schemaVersion}`
    });
  }
}
