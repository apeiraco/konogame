import assert from "node:assert/strict";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "@effect/vitest";
import { RenameStatus } from "@konogame/workspace";
import { Effect } from "effect";
import { v7 as uuidv7 } from "uuid";
import { executeTestProcess } from "../../../../tests/support/process.ts";
import { fixture } from "../support/workspace-fixture.ts";

const request = (
  f: Awaited<ReturnType<typeof fixture>>,
  uniformName: string,
  recordId = f.game.id
) =>
  Effect.gen(function* () {
    return {
      root: f.root,
      recordId,
      uniformName,
      expectedRevision: (yield* f.read()).revision,
      operationId: uuidv7()
    };
  });

it.effect(
  "actual child process crash releases stale lock and recovers host record and companion container through staged paths",
  () =>
    Effect.gen(function* () {
      const f = yield* Effect.promise(() => fixture());
      yield* Effect.gen(function* () {
        const input = yield* request(f, "After crash", f.host.id);
        yield* Effect.promise(() =>
          assert.rejects(
            () =>
              executeTestProcess(
                process.execPath,
                [
                  fileURLToPath(new URL("../support/crash-rename.ts", import.meta.url)),
                  "4",
                  JSON.stringify(input)
                ],
                { cwd: f.root, timeout: 8_000 }
              ),
            (failure: unknown) => (failure as { exitCode: number }).exitCode === 79
          )
        );
        assert.ok(
          yield* Effect.promise(() =>
            readFile(join(f.root, ".konogame", "recovery/rename/writer.lock"), "utf8")
          )
        );
        const result = yield* f.adapter.rename({
          ...input,
          expectedRevision: "recovery-only",
          operationId: uuidv7()
        });
        assert.equal(result.status, RenameStatus.Renamed, result.reason ?? "");
        const snapshot = yield* f.read();
        assert.equal(snapshot.hosts[0]?.uniformName, "After crash");
        assert.equal(snapshot.installations.length, 1);
        assert.deepEqual(
          yield* Effect.promise(() => readdir(join(f.root, ".konogame", "recovery/rename"))),
          []
        );
        assert.equal(
          (yield* f.adapter.rename({
            ...input,
            uniformName: "Another new name",
            expectedRevision: "recovery-only"
          })).status,
          RenameStatus.Conflict
        );
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.promise(() => rm(f.root, { recursive: true, force: true }));
          }).pipe(Effect.orDie)
        )
      );
    })
);
