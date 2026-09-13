import {
  discoverySourceCapability,
  GameCapability,
  GameOperation,
  GamePort
} from "@konogame/game/contracts";
import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  type ExtensionManifest
} from "@konogame/infrastructure/contracts";
import { adapterPortVersionRanges, extensionMetadata } from "./metadata.ts";

export const steamSourceKind = "steam";
const gameDiscoveryAdapterId = "steam.game-discovery";
export const steamFilesystemDependencyId = "konogame.filesystem";

export const steamGameDiscoveryAdapter: AdapterDescriptor = {
  id: gameDiscoveryAdapterId,
  owner: { kind: AdapterOwnerKind.Extension, id: extensionMetadata.id },
  port: GamePort.Discovery,
  portVersionRange: adapterPortVersionRanges[gameDiscoveryAdapterId],
  declarationProtocolRange: extensionMetadata.declarationProtocolRange,
  operations: [GameOperation.Discover],
  capabilities: [
    GameCapability.LocalDiscovery,
    GameCapability.ScopedDiscovery,
    discoverySourceCapability(steamSourceKind)
  ]
};
export const steamManifest: ExtensionManifest = {
  ...extensionMetadata,
  dependencies: [
    { extensionId: steamFilesystemDependencyId, versionRange: ">=0.1.0-alpha.0 <0.2.0" }
  ],
  activationEvents: [],
  contributes: { adapters: [steamGameDiscoveryAdapter] }
};
