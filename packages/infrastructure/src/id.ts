import { Context, Effect, Layer } from "effect";
import { v7 } from "uuid";

export class ID_SERVICE extends Context.Service<ID_SERVICE, IdService>()(
  "infrastructure.id-service"
) {}

export interface IdService {
  uuidV7(): Effect.Effect<string>;
}

export class UuidIdService implements IdService {
  uuidV7(): Effect.Effect<string> {
    return Effect.sync(() => v7());
  }
}

export function provideIdService(service?: IdService): Layer.Layer<ID_SERVICE> {
  return Layer.succeed(ID_SERVICE, service ?? new UuidIdService());
}
