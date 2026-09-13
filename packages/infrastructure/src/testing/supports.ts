import { provideIdService, provideTemporalService } from "@konogame/infrastructure";
import { Effect } from "effect";

const fixedInstant = Temporal.Instant.from("2026-10-17T00:00:00Z");

/**
 * One UUID sequence per call.
 * A shared module counter would couple tests that happen to load this file together.
 * The package entry import keeps these Context tags identical to the tags the caller resolved.
 */
export function deterministicIdLayer() {
  let sequence = 100;
  return provideIdService({
    uuidV7: () =>
      Effect.sync(() => `019a0000-0000-7000-8000-${(++sequence).toString(16).padStart(12, "0")}`)
  });
}

export function fixedTemporalLayer() {
  return provideTemporalService({ now: () => Effect.succeed(fixedInstant) });
}
