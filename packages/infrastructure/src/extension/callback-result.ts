import { isPromise } from "node:util/types";
import { Effect } from "effect";

export function requireExtensionEffect<A, E, R>(
  value: Effect.Effect<A, E, R>,
  message: string
): Effect.Effect<A, E, R> {
  if (!Effect.isEffect(value)) {
    observeNativePromise(value);
    throw new Error(message);
  }
  return value;
}

/** Observe only native Promises without reading or assimilating an arbitrary thenable. */
export function observeNativePromise(value: unknown): boolean {
  if (!isPromise(value)) {
    return false;
  }
  void Promise.prototype.then.call(value, undefined, () => {});
  return true;
}
