import { expect, it } from "@effect/vitest";
import { type Artifact } from "@konogame/infrastructure/contracts";
import { Effect, Stream } from "effect";
import { executeSave } from "../save/command.ts";
import { provideTestCli, testCliContext } from "./support/context.ts";

it.effect("save command uses injected input after a compatible store plan", () => {
  const calls: string[] = [];
  const artifact: Artifact = { mediaType: "application/octet-stream", files: Stream.empty };
  const io = testCliContext();
  return executeSave({
    kind: "save store",
    directory: "selected-directory",
    adapter: undefined,
    json: true,
    interactive: false,
    nonInteractive: true
  }).pipe(
    (effect) =>
      provideTestCli(effect, io.context, {
        plan: {
          plan: () =>
            Effect.sync(() => {
              calls.push("plan");
              return { resolvedAdapters: [{ adapterId: "fixture.save-store" }], unavailable: [] };
            })
        },
        artifactInput: {
          fromDirectory: (directory: string) =>
            Effect.sync(() => {
              calls.push(directory);
              return artifact;
            })
        },
        save: {
          storeSave: (value: Artifact) =>
            Effect.sync(() => {
              expect(value).toBe(artifact);
              calls.push("store");
              return { stored: true };
            })
        }
      }),
    Effect.tap(() =>
      Effect.sync(() => {
        expect(calls).toEqual(["plan", "selected-directory", "store"]);
        expect(io.stdout.join("")).toContain('"stored": true');
      })
    )
  );
});
