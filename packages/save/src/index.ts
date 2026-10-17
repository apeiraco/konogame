import {
  type Artifact,
  type ArtifactReference,
  CORE_CONTRACT_RANGE,
  type ModuleDescriptor
} from "@konogame/contracts";

export const saveModule: ModuleDescriptor = {
  id: "konogame.save",
  contractRange: CORE_CONTRACT_RANGE,
  features: [
    { id: "save.discover", port: "save.discover", operation: "discover", requiredCapabilities: [] },
    {
      id: "save.export",
      port: "save.export",
      operation: "export",
      requiredCapabilities: ["artifact.multifile", "artifact.streaming"]
    },
    {
      id: "save.import",
      port: "save.import",
      operation: "import",
      requiredCapabilities: ["artifact.multifile", "artifact.streaming"]
    },
    {
      id: "save.convert",
      port: "save.convert",
      operation: "convert",
      requiredCapabilities: ["artifact.multifile", "artifact.streaming"]
    },
    {
      id: "save.store",
      port: "save.store",
      operation: "put",
      requiredCapabilities: ["artifact.multifile", "artifact.streaming"]
    },
    {
      id: "save.history",
      port: "save.history",
      operation: "list",
      requiredCapabilities: ["history.versioned"]
    }
  ]
};

export interface SaveDiscoverPort {
  discover(gameId: string): Promise<readonly string[]>;
}

export interface SaveExportPort {
  export(gameId: string): Promise<Artifact>;
}

export interface SaveImportPort {
  import(gameId: string, artifact: Artifact): Promise<void>;
}

export interface SaveConvertPort {
  convert(artifact: Artifact, targetMediaType: string): Promise<Artifact>;
}

export interface SaveStorePort {
  put(artifact: Artifact): Promise<ArtifactReference>;
  open(reference: ArtifactReference): Promise<Artifact>;
}

export interface SaveHistoryPort {
  list(gameId: string): Promise<readonly ArtifactReference[]>;
}
