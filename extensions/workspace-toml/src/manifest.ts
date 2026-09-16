import {
  type AdapterDescriptor,
  AdapterOwnerKind,
  type ExtensionManifest
} from "@konogame/infrastructure/contracts";
import {
  WorkspaceCapability,
  WorkspaceOperation,
  WorkspacePort
} from "@konogame/workspace/contracts";
import { adapterPortVersionRanges, extensionMetadata } from "./metadata.ts";

const configurationAdapterId = "workspace-toml.configuration";

export const workspaceTomlConfigurationAdapter: AdapterDescriptor = {
  id: configurationAdapterId,
  owner: { kind: AdapterOwnerKind.Extension, id: extensionMetadata.id },
  port: WorkspacePort.Configuration,
  declarationProtocolRange: extensionMetadata.declarationProtocolRange,
  portVersionRange: adapterPortVersionRanges[configurationAdapterId],
  operations: [
    WorkspaceOperation.Read,
    WorkspaceOperation.Initialize,
    WorkspaceOperation.RecoverInitialize,
    WorkspaceOperation.Edit,
    WorkspaceOperation.RecoverEdit,
    WorkspaceOperation.Rename,
    WorkspaceOperation.Import,
    WorkspaceOperation.RecoverImport,
    WorkspaceOperation.Probe
  ],
  capabilities: [
    WorkspaceCapability.Records,
    WorkspaceCapability.Initialize,
    WorkspaceCapability.InitializeRecovery,
    WorkspaceCapability.Edit,
    WorkspaceCapability.EditRecovery,
    WorkspaceCapability.Rename,
    WorkspaceCapability.Import,
    WorkspaceCapability.ImportRecovery
  ]
};

export const workspaceTomlManifest: ExtensionManifest = {
  ...extensionMetadata,
  activationEvents: [],
  contributes: { adapters: [workspaceTomlConfigurationAdapter] }
};
