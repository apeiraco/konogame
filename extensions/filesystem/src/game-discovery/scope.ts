import { posix, win32 } from "node:path";
import { type } from "arktype";

export function isAbsoluteDiscoveryPath(value: string): boolean {
  return (
    !value.includes("\0") &&
    (posix.isAbsolute(value) ||
      (win32.isAbsolute(value) && /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(value)))
  );
}
const text = type.string.atLeastLength(1);
const discoveryPath = text.narrow(
  (value, ctx) => isAbsoluteDiscoveryPath(value) || ctx.mustBe("an absolute path")
);
const relativeDirectoryPrefix = text.narrow(
  (value, ctx) =>
    (!value.includes("\\") &&
      !value.includes("\0") &&
      !value.includes(":") &&
      !value.startsWith("/") &&
      value.split("/").every((part) => part !== ".." && part !== "." && part !== "")) ||
    ctx.mustBe("a relative directory prefix")
);
export const directoryDiscoveryScopeSchema = type({
  "+": "reject",
  paths: discoveryPath.array().atLeastLength(1).atMostLength(64),
  maxDepth: type("0 <= number.integer <= 16"),
  // Exclusions are relative directory prefixes, not glob expressions.
  exclude: relativeDirectoryPrefix.array().atMostLength(256)
}).onDeepUndeclaredKey("reject");
export type DirectoryDiscoveryScope = (typeof directoryDiscoveryScopeSchema)["infer"];
