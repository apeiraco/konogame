import { expect, it } from "@effect/vitest";
import { ImportStatus, RenameStatus } from "@konogame/workspace";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { NodeWorkspaceFileSystem, WORKSPACE_NODE_FILESYSTEM } from "../../src/filesystem/node.ts";
import { loadConfigurationState } from "../../src/operations/configuration.ts";
import { nativePromise } from "../support/effects.ts";
import { fixture, workspaceConfiguration } from "../support/workspace-fixture.ts";

it.effect.each(["flat", "directory"] as const)(
  "reads and renames opaque Location metadata without its Extension in %s layout",
  (layout) =>
    Effect.gen(function* () {
      const f = yield* nativePromise(fixture(layout));
      const location = {
        type: "missing.managed",
        schemaVersion: "8.4.0",
        data: {
          nested: { handle: "opaque:synthetic" },
          values: ["x", 7, true]
        }
      };
      yield* nativePromise(f.write(f.paths.installation, { ...f.installation, location }));
      yield* nativePromise(
        f.writeText(
          f.paths.installation,
          `# Preserve unknown vendor metadata\n${yield* nativePromise(f.text(f.paths.installation))}`
        )
      );
      const adapter = workspaceConfiguration();
      const snapshot = yield* adapter.read({ root: f.root });
      expect(snapshot.installations[0]?.location).toEqual(location);
      const before = yield* nativePromise(f.text(f.paths.installation));
      const renamed = yield* adapter.rename({
        root: f.root,
        recordId: f.installation.id,
        uniformName: "Renamed opaque",
        expectedRevision: snapshot.revision,
        operationId: uuidv7()
      });
      expect(renamed.status).toBe(RenameStatus.Renamed);
      expect((yield* adapter.read({ root: f.root })).installations[0]?.location).toEqual(location);
      const content = (yield* loadConfigurationState(f.root).pipe(
        Effect.provideService(WORKSPACE_NODE_FILESYSTEM, new NodeWorkspaceFileSystem())
      )).documents.find(({ record }) => record.id === f.installation.id)?.content;
      const locationLine = before.split("\n").find((line) => line.startsWith('"location"'));
      expect(locationLine).toBeDefined();
      expect(content).toContain(locationLine);
      expect(content).toContain("# Preserve unknown vendor metadata");
    })
);

it.effect(
  "requires resolved validation and comparison before admitting new Location metadata",
  () =>
    Effect.gen(function* () {
      const f = yield* nativePromise(fixture());
      const input = {
        root: f.root,
        operationId: uuidv7(),
        expectedRevision: (yield* f.read()).revision,
        games: [],
        installations: [{ ...f.installation, id: uuidv7(), uniformName: "Unverified import" }]
      };
      const result = yield* workspaceConfiguration().import(input);
      expect(result.status).toBe(ImportStatus.Failed);
      expect(result.reason).toContain("Location behavior is unavailable");
      expect((yield* f.read()).revision).toBe(input.expectedRevision);
    })
);
