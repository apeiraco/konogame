import { type Stats } from "node:fs";
import {
  access,
  lstat,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { Effect } from "effect";
import { type DevCliError, external } from "./context.ts";

function causeCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;
}

function ifMissing<A>(effect: Effect.Effect<A, DevCliError>, fallback: A) {
  return effect.pipe(
    Effect.catch((error) =>
      causeCode(error.cause) === "ENOENT" ? Effect.succeed(fallback) : Effect.fail(error)
    )
  );
}

export const readText = (path: string) => external(() => readFile(path, "utf8"));
export const readTextOptional = (path: string) => ifMissing(readText(path), null);
export const inspect = (path: string): Effect.Effect<Stats, DevCliError> =>
  external(() => lstat(path));
export const inspectOptional = (path: string) => ifMissing(inspect(path), undefined);
export const follow = (path: string): Effect.Effect<Stats, DevCliError> =>
  external(() => stat(path));
export const listNames = (path: string) => external(() => readdir(path));
export const listNamesOptional = (path: string) => ifMissing(listNames(path), [] as string[]);
export const pathExists = (path: string) =>
  external(() => access(path)).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      causeCode(error.cause) === "ENOENT" ? Effect.succeed(false) : Effect.fail(error)
    )
  );
export const canonicalPath = (path: string) => external(() => realpath(path));
export const linkTarget = (path: string) => external(() => readlink(path));
export const writeText = (path: string, content: string) =>
  external(() => writeFile(path, content));
export const writeNewText = (path: string, content: string) =>
  external(() => writeFile(path, content, { flag: "wx" }));
export const movePath = (from: string, to: string) => external(() => rename(from, to));
export const removePath = (path: string) => external(() => rm(path, { force: true }));
