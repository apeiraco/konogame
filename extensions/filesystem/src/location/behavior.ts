import { posix, win32 } from "node:path";
import {
  type ConfigurationValue,
  type LocationContract,
  type LocationPort,
  toInternalSchema
} from "@konogame/contracts";
import { type } from "arktype";
import { Effect } from "effect";
import semver from "semver";
import { FilesystemLocationType, filesystemLocationTypes } from "./values.ts";

export { filesystemLocationAdapter } from "../manifest.ts";
export * from "./values.ts";

const locationData = new Map(
  filesystemLocationTypes.map((definition) => [
    definition.type,
    toInternalSchema(definition.dataSchema)
  ])
);
const rootRecord = type("object");
const rootPath = type.string.atLeastLength(1);

export class FilesystemLocationBehavior implements LocationPort {
  private path(
    location: LocationContract,
    context: Record<string, ConfigurationValue> = {}
  ): { path: string; windows: boolean } {
    const definition = filesystemLocationTypes.find(
      (definition) => definition.type === location.type
    );
    if (!definition) throw new Error(`Unsupported filesystem Location type: ${location.type}`);
    if (!semver.satisfies(location.schemaVersion, definition.schemaRange))
      throw new Error(`Unsupported filesystem Location schema: ${location.schemaVersion}`);
    const parsed = locationData.get(location.type)!(location.data);
    if (parsed instanceof type.errors) throw new Error("Invalid filesystem Location data");
    const data = parsed as { path: string; rootKey?: string };
    const path = data.path;
    if (path.includes("\0")) throw new Error("Filesystem path contains a null byte");
    const windows =
      context.platform === "windows" ||
      context.platform === "win32" ||
      (context.platform === undefined && process.platform === "win32");
    const paths = windows ? win32 : posix;
    const safeWindows = (value: string) =>
      !/^[\\/]{2}[?.][\\/]/.test(value) &&
      value
        .replace(/^[a-z]:/i, "")
        .split(/[\\/]/)
        .every(
          (part) => !part.includes(":") && (part === "." || part === ".." || !/[. ]$/.test(part))
        );
    if (windows && !safeWindows(path)) throw new Error("Ambiguous Windows filesystem path");
    const absolute = (value: string) =>
      paths.isAbsolute(value) &&
      (!windows || /^(?:[a-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/i.test(value));
    const relative = location.type === FilesystemLocationType.Relative;
    if (!relative) {
      if (!absolute(path)) throw new Error("Filesystem Location path must be absolute");
      return { path: paths.normalize(path), windows };
    }
    const roots = rootRecord(context.roots);
    const root =
      roots instanceof type.errors ? undefined : rootPath(Reflect.get(roots, data.rootKey ?? ""));
    if (
      root instanceof type.errors ||
      root === undefined ||
      !absolute(root) ||
      root.includes("\0") ||
      (windows && !safeWindows(root))
    )
      throw new Error(`Unknown or invalid Host root: ${data.rootKey}`);
    if (paths.isAbsolute(path) || (windows && path.includes(":")))
      throw new Error("Filesystem relative Location path must be relative");
    const resolved = paths.resolve(root, path);
    const suffix = paths.relative(root, resolved);
    if (suffix === ".." || suffix.startsWith(`..${paths.sep}`) || paths.isAbsolute(suffix))
      throw new Error("Filesystem relative Location escapes Host root");
    return { path: resolved, windows };
  }

  validate(
    input: Parameters<NonNullable<LocationPort["validate"]>>[0]
  ): ReturnType<NonNullable<LocationPort["validate"]>> {
    return Effect.sync(() => {
      try {
        this.path(input.location, input.context);
        return { status: "valid" as const };
      } catch (error) {
        return { status: "invalid" as const, reason: String(error) };
      }
    });
  }
  compare(
    input: Parameters<NonNullable<LocationPort["compare"]>>[0]
  ): ReturnType<NonNullable<LocationPort["compare"]>> {
    return Effect.sync(() => {
      if (
        ![input.left, input.right].every((location) =>
          filesystemLocationTypes.some(({ type }) => type === location.type)
        )
      )
        return {
          status: "incomparable" as const,
          reason: "Filesystem cannot compare another Extension's Location"
        };
      try {
        const left = this.path(input.left, input.context);
        const right = this.path(input.right, input.context);
        const identity = (value: string) => {
          const paths = left.windows ? win32 : posix;
          const root = paths.parse(value).root;
          const trimmed =
            value.length > root.length
              ? value.replace(left.windows ? /[\\/]+$/ : /\/+$/, "")
              : value;
          return left.windows ? trimmed.toLowerCase() : trimmed;
        };
        return {
          status: identity(left.path) === identity(right.path) ? "equal" : "different"
        };
      } catch (error) {
        return { status: "unknown" as const, reason: String(error) };
      }
    });
  }
  resolve(
    input: Parameters<NonNullable<LocationPort["resolve"]>>[0]
  ): ReturnType<NonNullable<LocationPort["resolve"]>> {
    return Effect.sync(() => {
      try {
        const { path } = this.path(input.location, input.context);
        return {
          status: "resolved" as const,
          resource: {
            type: "filesystem.path",
            schemaVersion: "1.0.0",
            data: { path }
          }
        };
      } catch (error) {
        return { status: "unavailable" as const, reason: String(error) };
      }
    });
  }
}
