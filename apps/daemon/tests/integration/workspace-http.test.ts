import assert from "node:assert/strict";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, it } from "@effect/vitest";
import {
  NodeWorkspaceFileSystem,
  NodeWorkspaceManagementFileSystem,
  WORKSPACE_MANAGEMENT_FILESYSTEM,
  WorkspaceFileSystemError
} from "@konogame/extension-workspace-toml";
import { UuidIdService } from "@konogame/infrastructure";
import {
  ConfigurationEditKind,
  EditStatus,
  HistoryMode,
  HostPlatform,
  InitializeStatus,
  RecordKind,
  RenameStatus,
  WORKSPACE_SCHEMA
} from "@konogame/workspace/contracts";
import { workspaceEditPreviewSchema } from "@konogame/workspace/management";
import { Effect, Layer } from "effect";
import { workspaceInspectResponseSchema } from "../../src/api/workspace-schemas.ts";
import { startDaemon } from "../../src/main.ts";

const ids = new UuidIdService();

function fixture(fileSystem?: NodeWorkspaceManagementFileSystem) {
  return Effect.gen(function* () {
    const root = resolve(
      import.meta.dirname,
      "../../temp/tests/workspace-http",
      yield* ids.uuidV7()
    );
    yield* Effect.acquireRelease(
      Effect.promise(() => mkdir(root, { recursive: true })),
      () => Effect.promise(() => rm(root, { recursive: true, force: true }))
    );
    const host = {
      schemaVersion: WORKSPACE_SCHEMA,
      kind: RecordKind.Host,
      id: yield* ids.uuidV7(),
      uniformName: "synthetic-host",
      label: "Synthetic Host",
      platform: HostPlatform.Windows,
      roots: {},
      defaults: {},
      gameOverrides: {},
      sources: []
    };
    const input = {
      root,
      confirmed: true,
      operationId: yield* ids.uuidV7(),
      workspace: {
        schemaVersion: WORKSPACE_SCHEMA,
        kind: RecordKind.Workspace,
        id: yield* ids.uuidV7(),
        name: "Synthetic Workspace",
        defaults: {},
        history: { mode: HistoryMode.Disabled }
      },
      host
    };
    const server = yield* startDaemon({
      port: 0,
      saveRoot: join(root, "saves"),
      overrides: fileSystem
        ? Layer.succeed(WORKSPACE_MANAGEMENT_FILESYSTEM, fileSystem)
        : Layer.empty
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, body?: unknown) =>
      Effect.promise(async () => {
        const response = await fetch(
          `${base}${path}`,
          body === undefined
            ? {}
            : {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body)
              }
        );
        return { status: response.status, body: await response.json() };
      });
    const inspect = () =>
      request(`/api/workspace/inspect?${new URLSearchParams({ root })}`).pipe(
        Effect.map((result) => ({
          ...result,
          body: workspaceInspectResponseSchema.assert(result.body)
        }))
      );
    return { root, input, host, request, inspect };
  });
}

it.live(
  "HTTP Workspace initialization, reviewed edits, Host creation, rename and settings explanation use real owner workflows",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const marker = join(f.root, ".gitignore");
      yield* Effect.promise(() => writeFile(marker, "# existing user rules\r\n"));
      const { confirmed: _, ...unconfirmed } = f.input;
      expect((yield* f.request("/api/workspace/initialize", unconfirmed)).status).toBe(400);
      expect(yield* Effect.promise(() => readdir(f.root))).toEqual([".gitignore"]);
      expect(yield* f.request("/api/workspace/initialize", f.input)).toMatchObject({
        status: 200,
        body: {
          status: InitializeStatus.Initialized,
          operationId: f.input.operationId,
          workspaceId: f.input.workspace.id
        }
      });
      expect(yield* Effect.promise(() => readFile(marker, "utf8"))).toBe(
        "# existing user rules\r\n"
      );
      expect(
        yield* f.request("/api/workspace/initialize", {
          ...f.input,
          operationId: yield* ids.uuidV7()
        })
      ).toMatchObject({
        status: 409,
        body: { status: InitializeStatus.Conflict }
      });
      expect(yield* f.inspect()).toMatchObject({
        status: 200,
        body: { counts: { games: 0, hosts: 1, installations: 0 } }
      });
      const host = {
        ...f.host,
        id: yield* ids.uuidV7(),
        uniformName: "second-host",
        label: "Second Host"
      };
      const preview = yield* f.request("/api/workspace/hosts/preview", { root: f.root, host });
      expect(preview.status).toBe(200);
      expect(yield* f.inspect()).toMatchObject({ body: { counts: { hosts: 1 } } });
      expect(
        (yield* f.request("/api/workspace/hosts", { root: f.root, preview: preview.body })).status
      ).toBe(400);
      expect(
        (yield* f.request("/api/workspace/hosts", { confirmed: true, preview: preview.body }))
          .status
      ).toBe(400);
      expect(
        yield* f.request("/api/workspace/hosts", {
          root: f.root,
          confirmed: true,
          preview: preview.body
        })
      ).toMatchObject({
        status: 200,
        body: { status: EditStatus.Edited, recordId: host.id }
      });
      const beforeRename = yield* f.inspect();
      expect(beforeRename.body.counts.hosts).toBe(2);
      const rename = yield* f.request("/api/workspace/rename", {
        root: f.root,
        recordId: host.id,
        uniformName: "renamed-host",
        expectedRevision: beforeRename.body.revision,
        operationId: yield* ids.uuidV7(),
        confirmed: true
      });
      expect(rename).toMatchObject({ status: 200, body: { status: RenameStatus.Renamed } });
      expect((yield* f.inspect()).body.hosts).toContainEqual(
        expect.objectContaining({ id: host.id, uniformName: "renamed-host" })
      );
      const change = {
        kind: ConfigurationEditKind.SettingsReplace,
        target: { kind: RecordKind.Workspace, recordId: f.input.workspace.id },
        settings: {
          arguments: ["workspace"],
          preferredAdapters: { "workspace.inspect": "workspace-toml.configuration" }
        }
      };
      const settingsPreview = yield* f.request("/api/workspace/edit/preview", {
        root: f.root,
        change
      });
      expect(settingsPreview.status).toBe(200);
      expect(
        yield* f.request("/api/workspace/edit/apply", {
          root: f.root,
          confirmed: true,
          preview: settingsPreview.body
        })
      ).toMatchObject({
        status: 200,
        body: { status: EditStatus.Edited }
      });
      expect(
        yield* f.request("/api/workspace/explain", {
          root: f.root,
          selection: {
            overrides: { arguments: [], clear: { preferredAdapters: ["workspace.inspect"] } }
          },
          featureIds: ["workspace.inspect"]
        })
      ).toMatchObject({
        status: 200,
        body: {
          effective: {
            values: { arguments: [], preferredAdapters: { "workspace.inspect": null } },
            origins: { arguments: "invocation" }
          }
        }
      });
      expect(yield* f.request("/api/workspace/schema")).toMatchObject({
        status: 200,
        body: { $schema: "https://json-schema.org/draft/2020-12/schema" }
      });
      expect(
        yield* f.request("/api/workspace/recover-initialize", {
          root: f.root,
          operationId: f.input.operationId,
          confirmed: true
        })
      ).toMatchObject({
        status: 409,
        body: { status: InitializeStatus.RecoveryRequired }
      });
    })
);

it.live(
  "HTTP edit application rejects changed roots, tampered reviews, stale revisions and malformed input before writes",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* f.request("/api/workspace/initialize", f.input);
      const change = {
        kind: ConfigurationEditKind.MetadataReplace,
        target: { kind: RecordKind.Workspace, recordId: f.input.workspace.id },
        metadata: { name: "Reviewed name" }
      };
      const preview = workspaceEditPreviewSchema.assert(
        (yield* f.request("/api/workspace/edit/preview", { root: f.root, change })).body
      );
      const apply = (root: string, value: unknown = preview) =>
        f.request("/api/workspace/edit/apply", { root, confirmed: true, preview: value });
      expect(yield* apply(join(f.root, "another-root"))).toMatchObject({
        status: 409,
        body: { error: { tag: "WorkspaceReviewMismatchError", issues: { kind: "root" } } }
      });
      expect(
        yield* apply(f.root, { ...preview, change: { ...change, metadata: { name: "Tampered" } } })
      ).toMatchObject({
        status: 409,
        body: { error: { tag: "WorkspaceReviewMismatchError", issues: { kind: "digest" } } }
      });
      const path = join(f.root, ".konogame/workspace.toml");
      const content = yield* Effect.promise(() => readFile(path, "utf8"));
      yield* Effect.promise(() => writeFile(path, `${content}# external editor\n`));
      expect(yield* apply(f.root)).toMatchObject({
        status: 409,
        body: { error: { tag: "WorkspaceReviewMismatchError", issues: { kind: "stale" } } }
      });
      expect(yield* Effect.promise(() => readFile(path, "utf8"))).toBe(
        `${content}# external editor\n`
      );
      expect((yield* f.inspect()).body.workspace.name).toBe(f.input.workspace.name);
      const invalidInputs = [
        { root: f.root, change, unknown: true },
        { root: f.root, change: { ...change, arbitraryPatch: true } },
        { root: "relative-root", change }
      ];
      for (const input of invalidInputs) {
        expect((yield* f.request("/api/workspace/edit/preview", input)).status).toBe(400);
      }
      expect(
        (yield* f.request(
          `/api/workspace/inspect?${new URLSearchParams({ root: f.root })}&root=duplicate`
        )).status
      ).toBe(400);
      expect(
        (yield* f.request("/api/workspace/edit/preview?unexpected=true", { root: f.root, change }))
          .status
      ).toBe(400);
      const fresh = (yield* f.request("/api/workspace/edit/preview", { root: f.root, change }))
        .body;
      expect(yield* apply(f.root, fresh)).toMatchObject({
        status: 200,
        body: { status: EditStatus.Edited }
      });
      expect((yield* f.inspect()).body.workspace.name).toBe("Reviewed name");
    })
);

class PublicationFailureFileSystem extends NodeWorkspaceManagementFileSystem {
  failInitialPublication = false;
  failEditPublication = false;

  constructor() {
    super(new NodeWorkspaceFileSystem(), ids);
  }

  override create(path: string, content: string) {
    if (this.failInitialPublication && path.endsWith("workspace.toml")) {
      this.failInitialPublication = false;
      return Effect.fail(
        WorkspaceFileSystemError.from("create", new Error("Synthetic publication failure"))
      );
    }
    return super.create(path, content);
  }

  override replace(path: string, content: string, before: string, operationId: string) {
    if (this.failEditPublication) {
      this.failEditPublication = false;
      return Effect.fail(
        WorkspaceFileSystemError.from("replace", new Error("Synthetic replacement failure"))
      );
    }
    return super.replace(path, content, before, operationId);
  }
}

it.live(
  "HTTP targeted initialization and edit recovery retain owner status, operation identity and approved metadata",
  () =>
    Effect.gen(function* () {
      const fileSystem = new PublicationFailureFileSystem();
      const f = yield* fixture(fileSystem);
      fileSystem.failInitialPublication = true;
      expect(yield* f.request("/api/workspace/initialize", f.input)).toMatchObject({
        status: 409,
        body: {
          status: InitializeStatus.RecoveryRequired,
          operationId: f.input.operationId,
          reason: expect.any(String)
        }
      });
      expect(
        yield* f.request("/api/workspace/recover-initialize", {
          root: f.root,
          confirmed: true,
          operationId: yield* ids.uuidV7()
        })
      ).toMatchObject({ status: 409, body: { status: InitializeStatus.RecoveryRequired } });
      expect(
        yield* f.request("/api/workspace/recover-initialize", {
          root: f.root,
          confirmed: true,
          operationId: f.input.operationId
        })
      ).toMatchObject({ status: 200, body: { status: InitializeStatus.Initialized } });
      const preview = workspaceEditPreviewSchema.assert(
        (yield* f.request("/api/workspace/edit/preview", {
          root: f.root,
          change: {
            kind: ConfigurationEditKind.MetadataReplace,
            target: { kind: RecordKind.Workspace, recordId: f.input.workspace.id },
            metadata: { name: "Approved recovery" }
          }
        })).body
      );
      fileSystem.failEditPublication = true;
      expect(
        yield* f.request("/api/workspace/edit/apply", { root: f.root, confirmed: true, preview })
      ).toMatchObject({
        status: 409,
        body: { status: EditStatus.RecoveryRequired, operationId: preview.operationId }
      });
      expect(
        yield* f.request("/api/workspace/recover-edit", {
          root: f.root,
          confirmed: true,
          operationId: yield* ids.uuidV7()
        })
      ).toMatchObject({ status: 409, body: { status: EditStatus.RecoveryRequired } });
      expect(
        yield* f.request("/api/workspace/recover-edit", {
          root: f.root,
          confirmed: true,
          operationId: preview.operationId
        })
      ).toMatchObject({ status: 200, body: { status: EditStatus.Edited } });
      expect((yield* f.inspect()).body.workspace.name).toBe("Approved recovery");
      expect(
        yield* f.request("/api/workspace/recover-edit", {
          root: f.root,
          confirmed: true,
          operationId: preview.operationId
        })
      ).toMatchObject({ status: 200, body: { status: EditStatus.Unchanged } });
      const noImport = yield* f.request("/api/workspace/recover-import", {
        root: f.root,
        confirmed: true,
        operationId: yield* ids.uuidV7()
      });
      expect(noImport).toMatchObject({
        status: 422,
        body: { status: "failed", reason: expect.any(String) }
      });
    })
);
