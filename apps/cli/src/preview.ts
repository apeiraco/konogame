import { open } from "node:fs/promises";
import { Effect } from "effect";
import { CliError, cliChecked, cliExternal } from "./context.ts";

const MAX_PREVIEW_BYTES = 8 * 1024 * 1024;

export function readBoundedJson(path: string) {
  return Effect.acquireUseRelease(
    cliExternal(() => open(path, "r")),
    (file) =>
      Effect.gen(function* () {
        const info = yield* cliExternal(() => file.stat());
        if (!info.isFile() || info.size > MAX_PREVIEW_BYTES) {
          return yield* Effect.fail(
            new CliError({
              message: "Discovery preview must be a regular JSON file no larger than 8 MiB"
            })
          );
        }
        // Grow only up to MAX_PREVIEW_BYTES + 1 if an external writer appends after stat.
        let buffer = Buffer.allocUnsafe(
          Math.min(MAX_PREVIEW_BYTES + 1, Math.max(info.size + 1, 4096))
        );
        let size = 0;
        while (size <= MAX_PREVIEW_BYTES) {
          if (size === buffer.length) {
            const next = Buffer.allocUnsafe(Math.min(MAX_PREVIEW_BYTES + 1, buffer.length * 2));
            buffer.copy(next, 0, 0, size);
            buffer = next;
          }
          const result = yield* cliExternal(() =>
            file.read(buffer, size, buffer.length - size, size)
          );
          if (!result.bytesRead) {
            break;
          }
          size += result.bytesRead;
        }
        if (size > MAX_PREVIEW_BYTES) {
          return yield* Effect.fail(new CliError({ message: "Discovery preview exceeds 8 MiB" }));
        }
        return yield* cliChecked(
          JSON.parse,
          new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))
        );
      }),
    (file) => cliExternal(() => file.close())
  );
}
