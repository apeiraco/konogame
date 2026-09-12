import { Effect } from "effect";
import { repositoryRoot } from "../repository.ts";
import { applyEdits, releaseEdits } from "./edits.ts";
import { loadMetadata } from "./metadata.ts";

export function syncRelease(root = repositoryRoot(), dryRun = false) {
  return Effect.gen(function* () {
    const metadata = yield* loadMetadata(root);
    const edits = yield* releaseEdits(root, metadata);
    if (!dryRun) {
      yield* applyEdits(root, edits);
    }
    return { version: metadata.project.version, dryRun, changed: edits.map((edit) => edit.path) };
  });
}
