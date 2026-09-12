import { Effect } from "effect";
import { DEV_OUTPUT } from "../context.ts";
import { type DevCommand, type DevCommandName } from "../parser/index.ts";
import { checkDocs } from "./check.ts";

type DocsCommand = Extract<DevCommand, { kind: typeof DevCommandName.checkDocs }>;

export function executeDocs(command: DocsCommand) {
  return checkDocs(command.root).pipe(
    Effect.flatMap((report) =>
      Effect.gen(function* () {
        const { stdout } = yield* DEV_OUTPUT;
        stdout(
          `Checked ${report.documents} canonical documents and local links, including archives.\n`
        );
      })
    )
  );
}
