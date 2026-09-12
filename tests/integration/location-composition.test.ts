import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "@effect/vitest";
import {
  serializeNewConfiguration,
  workspaceTomlConfigurationAdapter
} from "@konogame/extension-workspace-toml";
import { ADAPTER_RESOLUTION_PLANNER } from "@konogame/infrastructure";
import { recordFileKey, workspaceJsonSchema } from "@konogame/workspace";
import { WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { Context, Effect, Layer } from "effect";
import { records } from "../../packages/workspace/tests/support/records.ts";
import { createTestDirectory } from "../support/temp.ts";
import { composeInfrastructure } from "../support/use-cases.ts";

it.effect(
  "composition without filesystem Extension reads TOML configuration and preserves unknown filesystem Location bytes",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        createTestDirectory(import.meta.dirname, "integration", "location-composition", "workspace")
      );

      yield* Effect.gen(function* () {
        const { workspace, game, host, installation } = records();
        const base = join(root, ".konogame");
        const hostContainer = join(base, "local", recordFileKey(host.id, host.uniformName));
        const installationPath = join(
          hostContainer,
          "installations",
          recordFileKey(installation.id, installation.uniformName, ".toml")
        );
        const entries = [
          [join(base, "workspace.toml"), workspace],
          [join(base, "games", recordFileKey(game.id, game.uniformName, ".toml")), game],
          [join(base, "local", recordFileKey(host.id, host.uniformName, ".toml")), host],
          [installationPath, installation]
        ] as const;
        for (const [path, record] of entries) {
          yield* Effect.promise(() => mkdir(dirname(path), { recursive: true }));
          yield* Effect.promise(() =>
            writeFile(
              path,
              `# Unknown Location must survive without its Extension\n${serializeNewConfiguration(record)}`
            )
          );
        }
        const before = yield* Effect.promise(() => readFile(installationPath, "utf8"));
        const applicationContext = yield* Layer.build(composeInfrastructure());
        const management = Context.get(applicationContext, WORKSPACE_MANAGEMENT);
        const plan = Context.get(applicationContext, ADAPTER_RESOLUTION_PLANNER);
        const result = yield* management.inspectWorkspace(root, {
          hostId: host.id,
          installationId: installation.id
        });
        expect(result.adapterResolutionPlan.resolvedAdapters[0]?.owner).toEqual(
          workspaceTomlConfigurationAdapter.owner
        );
        expect(result.installations[0]?.location).toEqual(installation.location);
        expect(result.installations[0]?.locationStatus.validation.status).toBe("unverified");
        expect(result.installations[0]?.locationStatus.availability.status).toBe("unavailable");
        expect(
          result.installations[0]?.locationStatus.adapterResolutionPlan.unavailable[0]?.reason
        ).toMatch(/unknown|not registered|missing/i);
        expect(result.installations[0]).not.toHaveProperty("resolvedPath");
        expect(workspaceJsonSchema()).toBeDefined();
        expect(yield* Effect.promise(() => readFile(installationPath, "utf8"))).toBe(before);
        expect((yield* plan.plan(["save.store"])).unavailable).toHaveLength(1);
      }).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* Effect.promise(() => rm(root, { recursive: true, force: true }));
          }).pipe(Effect.orDie)
        )
      );
    })
);
