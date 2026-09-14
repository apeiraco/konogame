import {
  type Artifact,
  type ArtifactError,
  UnexpectedBoundaryError
} from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";

export interface DaemonArtifactInput {
  fromDirectory(
    directory: string
  ): Effect.Effect<Artifact, ArtifactError | UnexpectedBoundaryError>;
}

export class DAEMON_ARTIFACT_INPUT extends Context.Service<
  DAEMON_ARTIFACT_INPUT,
  DaemonArtifactInput
>()("daemon.artifact-input") {}

export function provideDaemonArtifactInput() {
  return Layer.succeed(DAEMON_ARTIFACT_INPUT, {
    fromDirectory: (directory) =>
      Effect.tryPromise({
        try: () => import("@konogame/extension-filesystem"),
        catch: (cause) =>
          new UnexpectedBoundaryError({
            boundary: "daemon.local-artifact-source-import",
            message: "Cannot load the local Artifact source",
            cause
          })
      }).pipe(Effect.flatMap(({ artifactFromDirectory }) => artifactFromDirectory(directory)))
  });
}
