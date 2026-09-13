import { expect, it } from "@effect/vitest";
import {
  type AdapterResolutionPlanner,
  AdapterResolutionUnavailableError,
  AdapterResolutionUnavailableKind,
  type AdapterResolver
} from "@konogame/infrastructure";
import {
  type AdapterResolutionPlan,
  type Artifact,
  type ResolvedAdapter
} from "@konogame/infrastructure/contracts";
import { Cause, Effect, Stream } from "effect";
import { type SaveStorePort } from "../../index.ts";
import { SaveStoreWorkflow } from "../workflow.ts";

const resolvedAdapter: ResolvedAdapter = {
  feature: "save.store",
  port: "save.store",
  operation: "put",
  adapterId: "fixture.store",
  owner: { kind: "module", id: "konogame.save" },
  declarationProtocolRange: "^0.2.0",
  portVersion: "0.2.0",
  portVersionRange: "^0.2.0",
  capabilities: []
};

const reference = { id: "artifact", mediaType: "application/octet-stream" };

function artifact(): Artifact {
  return { mediaType: "application/octet-stream", files: Stream.empty };
}

function planned(
  resolvedAdapters: readonly ResolvedAdapter[] = [resolvedAdapter],
  unavailable: AdapterResolutionPlan["unavailable"] = []
): AdapterResolutionPlan {
  return { declarationProtocolVersion: "0.2.0", resolvedAdapters, unavailable };
}

function workflow(options: {
  readonly plan: (
    features: readonly string[],
    preferences: Readonly<Record<string, string>>
  ) => Effect.Effect<AdapterResolutionPlan>;
  readonly store?: SaveStorePort;
}) {
  const plan = { plan: options.plan } as unknown as AdapterResolutionPlanner;
  const adapterResolver = {
    implementation: () => options.store
  } as unknown as AdapterResolver;
  return new SaveStoreWorkflow(plan, adapterResolver);
}

it.effect("storeSave forwards the artifact and adapter preference to the resolved store", () =>
  Effect.gen(function* () {
    const stored: Artifact[] = [];
    const requested: string[][] = [];
    let preferences: Readonly<Record<string, string>> = {};
    const save = workflow({
      plan: (features, received) => {
        requested.push([...features]);
        preferences = received;
        return Effect.succeed(planned());
      },
      store: {
        put: (received) =>
          Effect.sync(() => {
            stored.push(received);
            return reference;
          }),
        open: () => Effect.die(new Error("Unexpected open"))
      }
    });
    const input = artifact();
    const result = yield* save.storeSave(input, "fixture.store");
    expect(result).toEqual(reference);
    expect(stored[0]).toBe(input);
    expect(requested).toEqual([["save.store"]]);
    expect(preferences).toEqual({ "save.store": "fixture.store" });
  })
);

it.effect("storeSave reports an unavailable Adapter resolution without touching a store", () =>
  Effect.gen(function* () {
    let stores = 0;
    const save = workflow({
      plan: () =>
        Effect.succeed(
          planned(
            [],
            [
              {
                feature: "save.store",
                port: "save.store",
                operation: "put",
                reason: "No adapter"
              }
            ]
          )
        ),
      store: {
        put: () =>
          Effect.sync(() => {
            stores++;
            return reference;
          }),
        open: () => Effect.die(new Error("Unexpected open"))
      }
    });
    const exit = yield* Effect.exit(save.storeSave(artifact()));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(AdapterResolutionUnavailableError);
      if (error instanceof AdapterResolutionUnavailableError) {
        expect(error.issue.kind).toBe(AdapterResolutionUnavailableKind.Resolution);
      }
    }
    expect(stores).toBe(0);
  })
);

it.effect("storeSave reports a resolved Adapter whose implementation is not active", () =>
  Effect.gen(function* () {
    const save = workflow({ plan: () => Effect.succeed(planned()) });
    const exit = yield* Effect.exit(save.storeSave(artifact()));
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(AdapterResolutionUnavailableError);
      if (error instanceof AdapterResolutionUnavailableError) {
        expect(error.issue.kind).toBe(AdapterResolutionUnavailableKind.Implementation);
      }
    }
  })
);
