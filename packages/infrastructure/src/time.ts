import { Clock, Context, Effect, Layer } from "effect";

export class TEMPORAL_SERVICE extends Context.Service<TEMPORAL_SERVICE, TemporalService>()(
  "infrastructure.temporal-service"
) {}

export interface TemporalService {
  now(): Effect.Effect<Temporal.Instant>;
}

export class SystemTemporalService implements TemporalService {
  now(): Effect.Effect<Temporal.Instant> {
    return Clock.currentTimeMillis.pipe(
      Effect.map((millis) => Temporal.Instant.fromEpochMilliseconds(millis))
    );
  }
}

export function provideTemporalService(service?: TemporalService): Layer.Layer<TEMPORAL_SERVICE> {
  return Layer.succeed(TEMPORAL_SERVICE, service ?? new SystemTemporalService());
}
