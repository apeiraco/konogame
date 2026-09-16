import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  WORKSPACE_BROWSE_LIMIT,
  WorkspaceBrowseError,
  WorkspaceBrowseFailureKind
} from "@konogame/workspace/contracts";
import { Effect, Exit } from "effect";
import { createTestDirectory } from "../../../../../tests/support/temp.ts";
import { absoluteFilesystemLocation } from "../../location/values.ts";
import { FilesystemWorkspaceLocationBrowser } from "../adapter.ts";
import {
  NodeWorkspaceBrowseFileSystem,
  type WorkspaceBrowseFileSystem,
  workspaceBrowseFailure
} from "../io.ts";
import { type WorkspaceBrowseAccessPolicy } from "../policy.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const directory = (...hierarchy: string[]) =>
  Effect.promise(async () => {
    const root = await createTestDirectory(import.meta.dirname, "unit", ...hierarchy);
    roots.push(root);
    return root;
  });

function failureKind(exit: Exit.Exit<unknown, unknown>) {
  if (Exit.isSuccess(exit)) {
    return undefined;
  }
  const error = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  return error && "error" in error
    ? (error.error as { issue: { kind: string } }).issue.kind
    : undefined;
}

describe("filesystem Workspace location browser", () => {
  it.live("lists only direct child directories as sorted fs.absolute Locations", () =>
    Effect.gen(function* () {
      const root = yield* directory("workspace-browse", "children");
      yield* Effect.promise(async () => {
        await mkdir(join(root, "Game 10", "nested"), { recursive: true });
        await mkdir(join(root, "Game 2"));
        await writeFile(join(root, "notes.txt"), "synthetic");
      });
      const browser = new FilesystemWorkspaceLocationBrowser(new NodeWorkspaceBrowseFileSystem());
      const listing = yield* browser.list({
        location: absoluteFilesystemLocation(root),
        limit: 50
      });
      expect(listing.complete).toBe(true);
      expect(listing.entries).toEqual([
        {
          location: absoluteFilesystemLocation(join(root, "Game 2")),
          label: "Game 2",
          canBrowse: true
        },
        {
          location: absoluteFilesystemLocation(join(root, "Game 10")),
          label: "Game 10",
          canBrowse: true
        }
      ]);
    })
  );

  it.live("stops at the limit in one listing and marks it incomplete", () =>
    Effect.gen(function* () {
      const root = yield* directory("workspace-browse", "limit");
      yield* Effect.promise(() =>
        Promise.all(Array.from({ length: 505 }, (_, index) => mkdir(join(root, `dir-${index}`))))
      );
      let listings = 0;
      const native = new NodeWorkspaceBrowseFileSystem();
      const counting: WorkspaceBrowseFileSystem = {
        startingPoints: () => native.startingPoints(),
        listDirectories: (path, limit) => {
          listings++;
          return native.listDirectories(path, limit);
        }
      };
      const listing = yield* new FilesystemWorkspaceLocationBrowser(counting).list({
        location: absoluteFilesystemLocation(root),
        limit: 500
      });
      expect(listing.entries).toHaveLength(500);
      expect(listing.complete).toBe(false);
      expect(listings).toBe(1);
    })
  );

  it.live("classifies a missing directory and refuses Location types it does not own", () =>
    Effect.gen(function* () {
      const root = yield* directory("workspace-browse", "failures");
      const browser = new FilesystemWorkspaceLocationBrowser(new NodeWorkspaceBrowseFileSystem());
      const missing = yield* Effect.exit(
        browser.list({ location: absoluteFilesystemLocation(join(root, "absent")), limit: 10 })
      );
      expect(failureKind(missing)).toBe(WorkspaceBrowseFailureKind.Missing);
      const synthetic = yield* Effect.exit(
        browser.list({
          location: { type: "synthetic.shelf", schemaVersion: "1.0.0", data: { shelf: "A" } },
          limit: 10
        })
      );
      expect(failureKind(synthetic)).toBe(WorkspaceBrowseFailureKind.Unsupported);
    })
  );

  it.effect("offers starting points as browsable Locations without listing them", () =>
    Effect.gen(function* () {
      const fileSystem: WorkspaceBrowseFileSystem = {
        startingPoints: () => Effect.succeed([{ path: "/synthetic/home", label: "Home" }]),
        listDirectories: () => Effect.die("starting points must not list directories")
      };
      const listing = yield* new FilesystemWorkspaceLocationBrowser(fileSystem).list({ limit: 10 });
      expect(listing).toEqual({
        entries: [
          {
            location: absoluteFilesystemLocation("/synthetic/home"),
            label: "Home",
            canBrowse: true
          }
        ],
        complete: true
      });
    })
  );

  it.effect("bounds starting points and checks the injected policy before any browse I/O", () =>
    Effect.gen(function* () {
      const root = resolve("synthetic-workspace");
      const operations: string[] = [];
      const fileSystem: WorkspaceBrowseFileSystem = {
        startingPoints: () =>
          Effect.sync(() => {
            operations.push("starting-points");
            return [root, resolve("synthetic-other")].map((path) => ({ path, label: path }));
          }),
        listDirectories: (path) =>
          Effect.sync(() => {
            operations.push(`list:${path}`);
            return { entries: [], complete: true };
          })
      };
      const policy: WorkspaceBrowseAccessPolicy = {
        check: ({ path }) =>
          Effect.sync(() => {
            operations.push(`check:${path ?? "starting-points"}`);
          })
      };
      const browser = new FilesystemWorkspaceLocationBrowser(fileSystem, policy);
      const points = yield* browser.list({ limit: 1 });
      expect(points.entries).toHaveLength(1);
      expect(points.complete).toBe(false);
      yield* browser.list({
        location: absoluteFilesystemLocation(join(root, "..", "synthetic-workspace")),
        limit: 1
      });
      expect(operations).toEqual([
        "check:starting-points",
        "starting-points",
        `check:${root}`,
        `list:${root}`
      ]);

      const denied = new WorkspaceBrowseError({
        issue: { kind: WorkspaceBrowseFailureKind.Denied },
        message: "Browsing disabled"
      });
      const blocked = new FilesystemWorkspaceLocationBrowser(fileSystem, {
        check: () => Effect.fail(denied)
      });
      expect(failureKind(yield* Effect.exit(blocked.list({ limit: 1 })))).toBe(
        WorkspaceBrowseFailureKind.Denied
      );
      expect(
        failureKind(
          yield* Effect.exit(blocked.list({ location: absoluteFilesystemLocation(root), limit: 1 }))
        )
      ).toBe(WorkspaceBrowseFailureKind.Denied);
      expect(operations).toHaveLength(4);
    })
  );

  it.effect("rejects invalid absolute paths and limits without reaching I/O", () =>
    Effect.gen(function* () {
      const browser = new FilesystemWorkspaceLocationBrowser({
        startingPoints: () => Effect.die("Invalid input reached I/O"),
        listDirectories: () => Effect.die("Invalid input reached I/O")
      });
      const paths = ["..", "relative/path", "C:drive-relative", "\u0000"];
      if (process.platform === "win32") {
        paths.push(
          "\\root-relative",
          "\\\\synthetic-host",
          "C:\\Games\\ambiguous.",
          "C:\\Games:stream"
        );
      }
      for (const path of paths) {
        expect(
          failureKind(
            yield* Effect.exit(
              browser.list({ location: absoluteFilesystemLocation(path), limit: 1 })
            )
          )
        ).toBe(WorkspaceBrowseFailureKind.Unsupported);
      }
      for (const limit of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        1.5,
        WORKSPACE_BROWSE_LIMIT.Maximum + 1
      ]) {
        expect(failureKind(yield* Effect.exit(browser.list({ limit })))).toBe(
          WorkspaceBrowseFailureKind.Unsupported
        );
      }
    })
  );

  it.effect(
    "passes platform roots and Windows UNC shares to I/O without inspecting their contents",
    () =>
      Effect.gen(function* () {
        const paths =
          process.platform === "win32" ? ["C:\\", "\\\\synthetic-host\\share\\"] : ["/"];
        const listed: string[] = [];
        const browser = new FilesystemWorkspaceLocationBrowser({
          startingPoints: () => Effect.succeed([]),
          listDirectories: (path) =>
            Effect.sync(() => {
              listed.push(path);
              return { entries: [], complete: true };
            })
        });
        for (const path of paths) {
          expect(
            yield* browser.list({ location: absoluteFilesystemLocation(path), limit: 1 })
          ).toEqual({ entries: [], complete: true });
        }
        expect(listed).toEqual(paths);
      })
  );

  it("maps denied native listings to the denied kind with the native code", () => {
    const error = workspaceBrowseFailure(
      "/synthetic/locked",
      Object.assign(new Error("denied"), { code: "EACCES" })
    );
    expect(error.issue).toEqual({ kind: WorkspaceBrowseFailureKind.Denied, code: "EACCES" });
  });
});
