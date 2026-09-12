import {
  discoverySourceCapability,
  GameCapability,
  GameOperation,
  GamePort
} from "@konogame/game/contracts";
import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  ArtifactCapability,
  type ExtensionManifest,
  LocationCapability,
  LocationOperation,
  LocationPortId
} from "@konogame/infrastructure/contracts";
import { SaveOperation, SavePort } from "@konogame/save/contracts";
import { filesystemLocationTypes } from "./location/values.ts";
import { adapterPortVersionRanges, extensionMetadata } from "./metadata.ts";

export const filesystemSourceKind = "standalone";
const saveStoreAdapterId = "filesystem.save-store";
const locationAdapterId = "filesystem.location";
const gameDiscoveryAdapterId = "filesystem.game-discovery";

export const filesystemSaveStoreAdapter: AdapterDescriptor = {
  id: saveStoreAdapterId,
  owner: { kind: AdapterOwnerKind.Extension, id: extensionMetadata.id },
  port: SavePort.Store,
  portVersionRange: adapterPortVersionRanges[saveStoreAdapterId],
  declarationProtocolRange: extensionMetadata.declarationProtocolRange,
  operations: [SaveOperation.Put, SaveOperation.Open],
  capabilities: [ArtifactCapability.Multifile, ArtifactCapability.Streaming]
};
export const filesystemLocationAdapter: AdapterDescriptor = {
  id: locationAdapterId,
  owner: { kind: AdapterOwnerKind.Extension, id: extensionMetadata.id },
  port: LocationPortId,
  portVersionRange: adapterPortVersionRanges[locationAdapterId],
  declarationProtocolRange: extensionMetadata.declarationProtocolRange,
  operations: [LocationOperation.Validate, LocationOperation.Compare, LocationOperation.Resolve],
  capabilities: [
    LocationCapability.Validate,
    LocationCapability.Compare,
    LocationCapability.Resolve
  ],
  locations: filesystemLocationTypes.map(({ type, schemaRange }) => ({ type, schemaRange }))
};
export const filesystemGameDiscoveryAdapter: AdapterDescriptor = {
  id: gameDiscoveryAdapterId,
  owner: { kind: AdapterOwnerKind.Extension, id: extensionMetadata.id },
  port: GamePort.Discovery,
  portVersionRange: adapterPortVersionRanges[gameDiscoveryAdapterId],
  declarationProtocolRange: extensionMetadata.declarationProtocolRange,
  operations: [GameOperation.Discover],
  capabilities: [
    GameCapability.LocalDiscovery,
    GameCapability.ScopedDiscovery,
    discoverySourceCapability(filesystemSourceKind)
  ]
};
export const filesystemManifest: ExtensionManifest = {
  ...extensionMetadata,
  activationEvents: [],
  contributes: {
    locations: filesystemLocationTypes,
    adapters: [
      filesystemSaveStoreAdapter,
      filesystemLocationAdapter,
      filesystemGameDiscoveryAdapter
    ]
  }
};
