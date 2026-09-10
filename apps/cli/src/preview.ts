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
        if (!info.isFile() || info.size > MAX_PREVIEW_BYTES)
          return yield* Effect.fail(
            new CliError({
              message: "Discovery preview must be a regular JSON file no larger than 8 MiB"
            })
          );
        // A fixed buffer also bounds reads when an external writer grows the file after stat.
        const buffer = Buffer.alloc(MAX_PREVIEW_BYTES + 1);
        let size = 0;
        while (size < buffer.length) {
          const result = yield* cliExternal(() =>
            file.read(buffer, size, buffer.length - size, size)
          );
          if (!result.bytesRead) break;
          size += result.bytesRead;
        }
        if (size > MAX_PREVIEW_BYTES)
          return yield* Effect.fail(new CliError({ message: "Discovery preview exceeds 8 MiB" }));
        return yield* cliChecked(
          JSON.parse,
          new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))
        );
      }),
    (file) => cliExternal(() => file.close())
  );
}
