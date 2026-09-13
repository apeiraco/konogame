import { Effect, PubSub, Stream } from "effect";

/** Private synchronous publication keeps both catalog indexes ahead of consumers. */
export class PublicationChannel<T> {
  private constructor(private readonly hub: PubSub.PubSub<T>) {}
  static make<T>(initial?: { value: T }): Effect.Effect<PublicationChannel<T>> {
    return Effect.gen(function* () {
      const hub = yield* PubSub.unbounded<T>({ replay: initial ? 1 : 0 });
      if (initial) {
        PubSub.publishUnsafe(hub, initial.value);
      }
      return new PublicationChannel(hub);
    });
  }
  get stream(): Stream.Stream<T> {
    return Stream.fromPubSub(this.hub);
  }
  publish(value: T): void {
    PubSub.publishUnsafe(this.hub, value);
  }
  get shutdown(): Effect.Effect<void> {
    return PubSub.shutdown(this.hub);
  }
}

export function immutableSnapshot<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      immutableSnapshot(item);
    }
    Object.freeze(value);
  }
  return value;
}
