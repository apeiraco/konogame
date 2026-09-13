export function dataRecord(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Expected a plain data object");
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== "string" ||
      (allowed && !allowed.includes(key)) ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error("Expected known enumerable data fields");
    }
    result[key] = descriptor.value;
  }
  return result;
}

export function dataArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("Expected a plain data array");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  // Check the key count first so sparse arrays cannot force traversal of their advertised length.
  if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
    throw new Error("Data arrays must not contain holes");
  }
  const result: unknown[] = [];
  for (const key of keys) {
    if (key === "length") {
      continue;
    }
    const descriptor = typeof key === "string" ? descriptors[key] : undefined;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= length ||
      !descriptor?.enumerable ||
      !("value" in descriptor)
    ) {
      throw new Error("Expected enumerable array data entries");
    }
    result.push(descriptor.value);
  }
  return result;
}
