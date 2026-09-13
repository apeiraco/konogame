import { Data, type Effect } from "effect";

export const DiscoveryEntryKind = {
  Directory: "directory",
  File: "file",
  Link: "link",
  Other: "other"
} as const;
export type DiscoveryEntryKind = (typeof DiscoveryEntryKind)[keyof typeof DiscoveryEntryKind];
export interface DiscoveryFileInfo {
  kind: DiscoveryEntryKind;
  size: number;
  identity: string;
  readonly fileObject?: {
    readonly volumeId: string;
    readonly objectId: string;
    readonly birthTime?: string;
  };
}
export interface DiscoveryDirectoryEntry {
  name: string;
  kind: DiscoveryEntryKind;
}
export class DiscoveryFileSystemError extends Data.TaggedError("DiscoveryFileSystemError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly code?: string;
}> {}
export interface DiscoveryFileSystem {
  inspect(path: string): Effect.Effect<DiscoveryFileInfo, DiscoveryFileSystemError>;
  list(
    path: string,
    limit: number
  ): Effect.Effect<DiscoveryDirectoryEntry[], DiscoveryFileSystemError>;
  readText(path: string, maxBytes: number): Effect.Effect<string, DiscoveryFileSystemError>;
}
