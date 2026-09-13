import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "@effect/vitest";
import { SchemaValidationError } from "@konogame/infrastructure/contracts";
import {
  ConfigurationInputKind,
  ConfigurationJournalProblem,
  ConfigurationLayoutProblem
} from "@konogame/workspace";
import { Effect } from "effect";
import {
  NodeWorkspaceFileSystem,
  WORKSPACE_NODE_FILESYSTEM,
  WorkspaceFileSystemError
} from "../../src/filesystem/node.ts";
import { directory as configurationDirectory } from "../../src/operations/configuration.ts";
import { ConfigurationInvalidInputError } from "../../src/operations/errors.ts";
import { readRecovery } from "../../src/operations/rename.ts";
import { CONFIGURATION_RECORD_BYTE_LIMIT } from "../../src/toml/limits.ts";
import { fixture } from "../support/workspace-fixture.ts";

it.effect("configuration reads report invalid records as schema failures rather than I/O", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.promise(() => f.write(f.paths.game, { ...f.game, title: 42 }));
    const error = yield* Effect.flip(f.read());
    assert.ok(error instanceof SchemaValidationError);
    assert.equal(error.schemaId, "workspace.record");
  })
);
it.effect("configuration reads retain TOML syntax fields through the public Port", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    yield* Effect.promise(() => f.writeText(f.paths.game, "title = ["));
    const error = yield* Effect.flip(f.read());
    assert.ok(error instanceof ConfigurationInvalidInputError);
    assert.equal(error.issue.kind, ConfigurationInputKind.Syntax);
  })
);
it.effect("configuration reads preserve native owner tag, system code and cause identity", () =>
  Effect.gen(function* () {
    const native = Object.assign(new Error("Synthetic native I/O failure"), { code: "EIO" });
    const expected = WorkspaceFileSystemError.from("read-bytes", native);
    class FailingRead extends NodeWorkspaceFileSystem {
      override readBytes() {
        return Effect.fail(expected);
      }
    }
    const f = yield* Effect.promise(() => fixture("flat", { nodeFileSystem: new FailingRead() }));
    const observed = yield* f.read().pipe(
      Effect.as(undefined),
      Effect.catchTag("WorkspaceFileSystemError", (error) => Effect.succeed(error))
    );
    assert.equal(observed, expected);
    assert.equal(observed?.code, "EIO");
    assert.equal(observed?.cause, native);
  })
);

it.effect("file, link and byte-limit preconditions produce their exact structured issue", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const node = new NodeWorkspaceFileSystem();
    const file = join(f.root, ".konogame", f.paths.game);
    yield* Effect.promise(() => writeFile(file, "x".repeat(CONFIGURATION_RECORD_BYTE_LIMIT + 1)));
    const oversized = yield* Effect.flip(f.read());
    assert.ok(oversized instanceof ConfigurationInvalidInputError);
    assert.deepEqual(oversized.issue, {
      kind: ConfigurationInputKind.RecordSize,
      limit: CONFIGURATION_RECORD_BYTE_LIMIT,
      actual: CONFIGURATION_RECORD_BYTE_LIMIT + 1
    });
    const bounded = yield* Effect.flip(node.readBounded(file, 16));
    assert.ok(bounded instanceof ConfigurationInvalidInputError);
    assert.deepEqual(bounded.issue, {
      kind: ConfigurationInputKind.RecordSize,
      limit: 16,
      actual: CONFIGURATION_RECORD_BYTE_LIMIT + 1
    });
    const directory = join(f.root, ".konogame/games");
    const link = join(f.root, ".konogame/metadata-link");
    yield* Effect.promise(() => symlink(directory, link, "junction"));
    const linked = yield* Effect.flip(node.readBounded(link, 16));
    assert.ok(linked instanceof ConfigurationInvalidInputError);
    assert.deepEqual(linked.issue, {
      kind: ConfigurationInputKind.Layout,
      path: link,
      problem: ConfigurationLayoutProblem.Link
    });
    const linkedDirectory = yield* Effect.flip(
      configurationDirectory(link).pipe(Effect.provideService(WORKSPACE_NODE_FILESYSTEM, node))
    );
    assert.ok(linkedDirectory instanceof ConfigurationInvalidInputError);
    assert.deepEqual(linkedDirectory.issue, {
      kind: ConfigurationInputKind.Layout,
      path: link,
      problem: ConfigurationLayoutProblem.Link
    });
    const nonFile = yield* Effect.flip(node.readBounded(directory, 16));
    assert.ok(nonFile instanceof ConfigurationInvalidInputError);
    assert.deepEqual(nonFile.issue, {
      kind: ConfigurationInputKind.Layout,
      path: directory,
      problem: ConfigurationLayoutProblem.NotFile
    });
  })
);
it.effect("rename recovery distinguishes journal byte limits from layout and shape", () =>
  Effect.gen(function* () {
    const f = yield* Effect.promise(() => fixture());
    const root = join(f.root, ".konogame");
    const folder = join(root, "recovery/rename");
    yield* Effect.promise(() => mkdir(folder, { recursive: true }));
    const path = join(folder, "journal.json");
    const limit = 4 * 1024 * 1024;
    yield* Effect.promise(() => writeFile(path, "x".repeat(limit + 1)));
    const error = yield* Effect.flip(
      readRecovery(root, path).pipe(
        Effect.provideService(WORKSPACE_NODE_FILESYSTEM, new NodeWorkspaceFileSystem())
      )
    );
    assert.ok(error instanceof ConfigurationInvalidInputError);
    assert.deepEqual(error.issue, {
      kind: ConfigurationInputKind.InvalidJournal,
      workflow: "rename",
      problem: ConfigurationJournalProblem.Size,
      limit,
      actual: limit + 1
    });
  })
);
