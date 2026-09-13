import { Data, type Effect, type Stream } from "effect";

export const ArtifactCapability = {
  Multifile: "artifact.multifile",
  Streaming: "artifact.streaming"
} as const;
export type ArtifactCapability = (typeof ArtifactCapability)[keyof typeof ArtifactCapability];

export class ArtifactError extends Data.TaggedError("ArtifactError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class BlobError extends Data.TaggedError("BlobError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class SnapshotError extends Data.TaggedError("SnapshotError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ReplicationError extends Data.TaggedError("ReplicationError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Each file is opened on demand, so a multi-file artifact never requires a full buffer.
export interface ArtifactFile {
  path: string;
  size?: number;
  open(): Stream.Stream<Uint8Array, ArtifactError>;
}

export interface Artifact {
  mediaType: string;
  metadata?: Readonly<Record<string, string>>;
  files: Stream.Stream<ArtifactFile, ArtifactError>;
}

export interface ArtifactReference {
  id: string;
  mediaType: string;
}

export interface BlobPort {
  put(
    chunks: Stream.Stream<Uint8Array, ArtifactError>
  ): Effect.Effect<string, BlobError | ArtifactError>;
  open(id: string): Effect.Effect<Stream.Stream<Uint8Array, BlobError>, BlobError>;
}

export interface SnapshotPort {
  create(artifact: ArtifactReference): Effect.Effect<string, SnapshotError>;
  restore(id: string): Effect.Effect<ArtifactReference, SnapshotError>;
}

export interface ReplicationPort {
  replicate(
    reference: ArtifactReference,
    destination: string
  ): Effect.Effect<void, ReplicationError>;
}
