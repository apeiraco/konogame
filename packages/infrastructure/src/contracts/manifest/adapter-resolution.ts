import semver from "semver";
import { type LocationContract, locationContractSchema } from "../location/contract.ts";
import { DECLARATION_PROTOCOL_VERSION } from "../version.ts";
import {
  type AdapterDescriptor,
  type AdapterOwner,
  type CapabilityId,
  type Feature,
  type FeatureId,
  type OperationId,
  type PortId,
  supportsDeclarationProtocolRange
} from "./declarations.ts";

export interface AdapterResolutionRequest {
  feature: Feature;
  preferredAdapterId?: string;
  additionalCapabilities?: readonly CapabilityId[];
  locations?: readonly LocationContract[];
}

export interface ResolvedAdapter {
  feature: FeatureId;
  port: PortId;
  operation: OperationId;
  adapterId: string;
  owner: AdapterOwner;
  declarationProtocolRange: string;
  portVersion: string;
  portVersionRange: string;
  capabilities: readonly CapabilityId[];
}

export interface UnavailableAdapterResolution {
  feature: FeatureId;
  port: PortId;
  operation: OperationId;
  reason: string;
}

export interface AdapterResolutionPlan {
  /** The declaration protocol version; each ResolvedAdapter records its negotiated Port version. */
  declarationProtocolVersion: string;
  resolvedAdapters: readonly ResolvedAdapter[];
  unavailable: readonly UnavailableAdapterResolution[];
}

export function selectAdapters(
  requests: readonly AdapterResolutionRequest[],
  adapters: readonly AdapterDescriptor[]
): AdapterResolutionPlan {
  const resolvedAdapters: ResolvedAdapter[] = [];
  const unavailable: AdapterResolutionPlan["unavailable"][number][] = [];
  for (const request of requests) {
    const { feature } = request;
    for (const location of request.locations ?? []) {
      locationContractSchema.assert(location);
    }
    const required = [...feature.requiredCapabilities, ...(request.additionalCapabilities ?? [])];
    const candidates = adapters.filter(
      (adapter) =>
        adapter.port === feature.port &&
        supportsDeclarationProtocolRange(adapter.declarationProtocolRange) &&
        semver.valid(feature.portVersion) !== null &&
        semver.validRange(adapter.portVersionRange) !== null &&
        semver.satisfies(feature.portVersion, adapter.portVersionRange) &&
        adapter.operations.includes(feature.operation) &&
        required.every((capability) => adapter.capabilities.includes(capability)) &&
        (request.preferredAdapterId === undefined || adapter.id === request.preferredAdapterId) &&
        (request.locations ?? []).every((location) =>
          adapter.locations?.some(
            (support) =>
              support.type === location.type &&
              semver.validRange(support.schemaRange) !== null &&
              semver.satisfies(location.schemaVersion, support.schemaRange)
          )
        )
    );
    candidates.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
    const selected = candidates[0];
    if (!selected) {
      unavailable.push({
        feature: feature.id,
        port: feature.port,
        operation: feature.operation,
        reason:
          request.preferredAdapterId !== undefined
            ? `No compatible adapter matches preference ${request.preferredAdapterId}`
            : `No adapter satisfies declaration protocol ${DECLARATION_PROTOCOL_VERSION}, Port ${feature.port}@${feature.portVersion}, operation ${feature.operation}, capabilities ${required.join(", ") || "none"}, and Location schemas`
      });
      continue;
    }
    resolvedAdapters.push({
      feature: feature.id,
      port: feature.port,
      operation: feature.operation,
      adapterId: selected.id,
      owner: structuredClone(selected.owner),
      declarationProtocolRange: selected.declarationProtocolRange,
      portVersion: feature.portVersion,
      portVersionRange: selected.portVersionRange,
      capabilities: [...selected.capabilities]
    });
  }
  return {
    declarationProtocolVersion: DECLARATION_PROTOCOL_VERSION,
    resolvedAdapters,
    unavailable
  };
}
