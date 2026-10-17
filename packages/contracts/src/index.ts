import semver from "semver";
import { CONTRACT_VERSION } from "./version.ts";

export { CONTRACT_VERSION, CORE_CONTRACT_RANGE, CORE_VERSION } from "./version.ts";

export function supportsContractRange(range: string, version = CONTRACT_VERSION): boolean {
  return (
    typeof range === "string" &&
    semver.validRange(range) !== null &&
    semver.satisfies(version, range)
  );
}

export type FeatureId = string;
export type PortId = string;
export type OperationId = string;
export type CapabilityId = string;

export interface Feature {
  id: FeatureId;
  port: PortId;
  operation: OperationId;
  requiredCapabilities: readonly CapabilityId[];
}

export interface ModuleDescriptor {
  id: string;
  contractRange: string;
  features: readonly Feature[];
}

export interface AdapterDescriptor {
  id: string;
  extensionId: string;
  port: PortId;
  contractRange: string;
  operations: readonly OperationId[];
  capabilities: readonly CapabilityId[];
  priority?: number;
}

export interface ExtensionDescriptor {
  id: string;
  version: string;
  contractRange: string;
  software: Readonly<Record<string, string>>;
  adapters: readonly AdapterDescriptor[];
}

export interface BindingRequest {
  feature: Feature;
  preferredAdapterId?: string;
  additionalCapabilities?: readonly CapabilityId[];
}

export interface Binding {
  feature: FeatureId;
  port: PortId;
  operation: OperationId;
  adapterId: string;
  extensionId: string;
  contractRange: string;
  capabilities: readonly CapabilityId[];
}

export interface UnavailableBinding {
  feature: FeatureId;
  port: PortId;
  operation: OperationId;
  reason: string;
}

export interface BindingPlan {
  contractVersion: string;
  bindings: readonly Binding[];
  unavailable: readonly UnavailableBinding[];
}

// Each file is opened on demand, so a multi-file artifact never requires a full buffer.
export interface ArtifactFile {
  path: string;
  size?: number;
  open(): AsyncIterable<Uint8Array>;
}

export interface Artifact {
  mediaType: string;
  metadata?: Readonly<Record<string, string>>;
  files: AsyncIterable<ArtifactFile>;
}

export interface ArtifactReference {
  id: string;
  mediaType: string;
}

export interface BlobPort {
  put(chunks: AsyncIterable<Uint8Array>): Promise<string>;
  open(id: string): Promise<AsyncIterable<Uint8Array>>;
}

export interface SnapshotPort {
  create(artifact: ArtifactReference): Promise<string>;
  restore(id: string): Promise<ArtifactReference>;
}

export interface ReplicationPort {
  replicate(reference: ArtifactReference, destination: string): Promise<void>;
}
