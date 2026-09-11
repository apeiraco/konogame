import { type AdapterDescriptor, type ExtensionManifest } from "@konogame/contracts";
import { filesystemLocationTypes } from "./location/values.ts";
import { extensionMetadata } from "./metadata.ts";

export const filesystemSaveStoreAdapter: AdapterDescriptor = {
  id: "filesystem.save-store",
  owner: { kind: "extension", id: "konogame.filesystem" },
  port: "save.store",
  contractRange: extensionMetadata.contractRange,
  operations: ["put", "open"],
  capabilities: ["artifact.multifile", "artifact.streaming"]
};
export const filesystemLocationAdapter: AdapterDescriptor = {
  id: "filesystem.location",
  owner: { kind: "extension", id: "konogame.filesystem" },
  port: "location.behavior",
  contractRange: extensionMetadata.contractRange,
  operations: ["validate", "compare", "resolve"],
  capabilities: ["location.validation", "location.identity", "location.resolve"],
  locations: filesystemLocationTypes.map(({ type, schemaRange }) => ({ type, schemaRange }))
};
export const filesystemGameDiscoveryAdapter: AdapterDescriptor = {
  id: "filesystem.game-discovery",
  owner: { kind: "extension", id: "konogame.filesystem" },
  port: "game.discovery",
  contractRange: extensionMetadata.contractRange,
  operations: ["discover"],
  capabilities: ["discovery.local", "discovery.scoped", "discovery.source.standalone"]
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
