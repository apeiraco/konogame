import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { expect, it } from "@effect/vitest";
import { UuidIdService } from "@konogame/infrastructure";
import { type LocationPort } from "@konogame/infrastructure/contracts";
import { type ImportConfigurationInput, ImportStatus } from "@konogame/workspace";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { NodeWorkspaceFileSystem, WorkspaceFileSystemError } from "../../src/filesystem/node.ts";
import { NodeWorkspaceImportFileSystem } from "../../src/index.ts";
import { CONFIGURATION_RECORD_BYTE_LIMIT } from "../../src/toml/limits.ts";
import { nativePromise } from "../support/effects.ts";
import { fixture, workspaceConfiguration } from "../support/workspace-fixture.ts";

function directoryContents(root: string) {
  return Effect.gen(function* () {
    const entries = yield* nativePromise(readdir(root, { recursive: true, withFileTypes: true }));
    return Object.fromEntries(
      yield* Effect.all(
        entries
          .filter((entry) => entry.isFile())
          .map((entry) =>
            Effect.gen(function* () {
              const path = join(entry.parentPath, entry.name);
              return [relative(root, path), yield* nativePromise(readFile(path))];
            })
          )
      )
    );
  });
}

function directoryDigest(root: string) {
  return Effect.map(directoryContents(root), (contents) =>
    Object.fromEntries(
      Object.entries(contents).map(([path, bytes]) => [
        path,
        createHash("sha256")
          .update(bytes as Uint8Array)
          .digest("hex")
      ])
    )
  );
}

function setup() {
  return Effect.gen(function* () {
    const f = yield* nativePromise(fixture());
    const game = {
      ...f.game,
      id: uuidv7(),
      uniformName: "Imported",
      settings: { arguments: [""] }
    };
    const input: ImportConfigurationInput = {
      root: f.root,
      operationId: uuidv7(),
      expectedRevision: (yield* f.read()).revision,
      games: [game],
      installations: []
    };
    return { ...f, game, input };
  });
}

it.effect.each(["game arguments", "opaque Unicode Location"] as const)(
  "rejects oversized %s before publishing any record or journal",
  (kind) =>
    Effect.gen({ self: this }, function* () {
      const f = yield* setup();
      if (kind === "game arguments") {
        f.game.settings.arguments = ["x".repeat(CONFIGURATION_RECORD_BYTE_LIMIT)];
      } else {
        f.input.installations.push({
          ...f.installation,
          id: uuidv7(),
          gameId: f.game.id,
          uniformName: "Opaque imported",
          location: {
            type: "synthetic.opaque",
            schemaVersion: "1.0.0",
            data: {
              payload: "棣冨箖".repeat(CONFIGURATION_RECORD_BYTE_LIMIT / 4)
            }
          }
        });
      }
      const policy: LocationPort = {
        validate() {
          return Effect.succeed({ status: "valid" as const });
        },
        compare() {
          return Effect.succeed({ status: "different" as const });
        }
      };
      class TrackingFileSystem extends NodeWorkspaceImportFileSystem {
        constructor() {
          super(new NodeWorkspaceFileSystem(), new UuidIdService());
        }

        readonly created: string[] = [];
        override create(path: string, content: string) {
          const supercreate = super.create.bind(this);
          return Effect.gen({ self: this }, function* () {
            this.created.push(path);
            return yield* supercreate(path, content);
          });
        }
      }
      const fileSystem = new TrackingFileSystem();
      const before = yield* directoryContents(f.root);
      const result = yield* workspaceConfiguration({
        locationBehavior: policy,
        importFileSystem: fileSystem
      }).import(f.input);
      expect(result.status).toBe(ImportStatus.Failed);
      expect(result.reason).toContain("UTF-8 byte limit");
      expect(
        fileSystem.created.filter((path) => path.endsWith(".toml") || path.endsWith("journal.json"))
      ).toEqual([]);
      expect(yield* directoryContents(f.root)).toEqual(before);
      expect((yield* f.read()).revision).toBe(f.input.expectedRevision);
      expect((yield* f.read()).games).toHaveLength(1);
      expect((yield* f.read()).installations).toHaveLength(1);
    })
);

it.effect("rejects an oversized recovery entry before parsing or publishing it", () =>
  Effect.gen(function* () {
    const f = yield* setup();
    class FailBeforePublication extends NodeWorkspaceImportFileSystem {
      constructor() {
        super(new NodeWorkspaceFileSystem(), new UuidIdService());
      }

      override create(path: string, content: string) {
        const supercreate = super.create.bind(this);
        return Effect.gen({ self: this }, function* () {
          if (path.endsWith(".toml")) {
            return yield* Effect.fail(
              WorkspaceFileSystemError.from(
                "injected-test-failure",
                new Error("Synthetic publication failure")
              )
            );
          }
          return yield* supercreate(path, content);
        });
      }
    }
    expect(
      (yield* workspaceConfiguration({
        importFileSystem: new FailBeforePublication()
      }).import(f.input)).status
    ).toBe(ImportStatus.RecoveryRequired);
    const path = join(f.root, ".konogame/recovery/import/journal.json");
    const journal = JSON.parse(yield* nativePromise(readFile(path, "utf8"))) as {
      entries: { content: string }[];
    };
    journal.entries[0]!.content += `#${"x".repeat(CONFIGURATION_RECORD_BYTE_LIMIT)}\n`;
    yield* nativePromise(writeFile(path, JSON.stringify(journal)));
    const before = yield* directoryDigest(f.root);
    const result = yield* workspaceConfiguration().recoverImport({
      root: f.root,
      operationId: f.input.operationId
    });
    expect(result.status).toBe(ImportStatus.RecoveryRequired);
    expect(result.reason).toContain("UTF-8 byte limit");
    expect(yield* directoryDigest(f.root)).toEqual(before);
    expect((yield* f.read()).revision).toBe(f.input.expectedRevision);
  })
);
