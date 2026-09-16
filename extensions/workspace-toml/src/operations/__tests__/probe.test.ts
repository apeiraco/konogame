import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "@effect/vitest";
import { FilesystemResourceType } from "@konogame/extension-filesystem/location";
import { WorkspaceProbeStatus } from "@konogame/workspace";
import { Effect } from "effect";
import { createTestDirectory } from "../../../../../tests/support/temp.ts";
import {
  NodeWorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceNodeFileSystem
} from "../../filesystem/node.ts";
import { probeConfiguration } from "../probe.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const pathResource = (path: string) => ({
  resource: { type: FilesystemResourceType.Path, schemaVersion: "1.0.0", data: { path } }
});

describe("Workspace TOML probe", () => {
  it.live("finds the marker without validating the configuration it marks", () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "unit", "workspace-toml", "probe")
      );
      roots.push(root);
      const marked = join(root, "marked");
      yield* Effect.promise(async () => {
        await mkdir(join(marked, ".konogame"), { recursive: true });
        // Deliberately invalid TOML: only a formal read may reject it.
        await writeFile(join(marked, ".konogame", "workspace.toml"), "not = [valid");
        await mkdir(join(root, "plain"));
      });
      const fileSystem = new NodeWorkspaceFileSystem();
      expect(yield* probeConfiguration(fileSystem, pathResource(marked))).toEqual({
        status: WorkspaceProbeStatus.Present,
        root: marked
      });
      expect(yield* probeConfiguration(fileSystem, pathResource(join(root, "plain")))).toEqual({
        status: WorkspaceProbeStatus.Absent
      });
      expect(
        (yield* probeConfiguration(fileSystem, pathResource(join(root, "missing")))).status
      ).toBe(WorkspaceProbeStatus.Absent);
    })
  );

  it.effect("distinguishes a denied probe from a missing marker", () =>
    Effect.gen(function* () {
      const denied = {
        stat: (path: string) =>
          Effect.fail(
            WorkspaceFileSystemError.from(
              "stat",
              Object.assign(new Error(`denied ${path}`), { code: "EACCES" })
            )
          )
      } as unknown as WorkspaceNodeFileSystem;
      const result = yield* probeConfiguration(denied, pathResource("/synthetic/locked"));
      expect(result.status).toBe(WorkspaceProbeStatus.Denied);
    })
  );

  it.effect("reports resources it cannot interpret as unsupported without I/O", () =>
    Effect.gen(function* () {
      const untouched = {
        stat: () => Effect.die("an unsupported resource must not reach the filesystem")
      } as unknown as WorkspaceNodeFileSystem;
      const result = yield* probeConfiguration(untouched, {
        resource: { type: "synthetic.shelf-resource", schemaVersion: "1.0.0", data: { shelf: "A" } }
      });
      expect(result.status).toBe(WorkspaceProbeStatus.Unsupported);
      const path = pathResource("/synthetic");
      for (const resource of [
        { ...path.resource, schemaVersion: "2.0.0" },
        { ...path.resource, data: { path: "relative" } }
      ]) {
        expect((yield* probeConfiguration(untouched, { resource })).status).toBe(
          WorkspaceProbeStatus.Unsupported
        );
      }
    })
  );
});
