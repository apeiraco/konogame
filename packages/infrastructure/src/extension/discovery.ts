import { type Effect } from "effect";
import { type RegistrationStatus } from "../registry/extension-registry.ts";
import { type Contribution } from "./contribution.ts";
import { type LifecycleDiagnostic } from "./diagnostics.ts";

export interface ExtensionDiscoverySource {
  readonly id: string;
  discover(): Effect.Effect<DiscoveryBatch, unknown>;
}

export interface DiscoveryBatch {
  complete: boolean;
  contributions: readonly Contribution[];
  diagnostics?: readonly LifecycleDiagnostic[];
  restartRequired?: readonly string[];
}

export interface SourceSnapshot {
  id: string;
  contributionIds: readonly string[];
}

export interface RefreshResult {
  status: RegistrationStatus;
  sourceIds: readonly string[];
  added: readonly string[];
  unchanged: readonly string[];
  replaced: readonly string[];
  removed: readonly string[];
  restartRequired: readonly string[];
  diagnostics: readonly LifecycleDiagnostic[];
  catalogVersion: number;
}
