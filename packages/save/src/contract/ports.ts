import {
  type Artifact,
  ArtifactCapability,
  type ArtifactReference,
  DECLARATION_PROTOCOL_RANGE,
  HistoryCapability,
  type ModuleDescriptor
} from "@konogame/infrastructure/contracts";
import { type Effect } from "effect";
import {
  SAVE_CONVERT_PORT,
  SAVE_DISCOVER_PORT,
  SAVE_EXPORT_PORT,
  SAVE_HISTORY_PORT,
  SAVE_IMPORT_PORT,
  SAVE_STORE_PORT
} from "../version.ts";
import { type SaveError } from "./errors.ts";

export const SaveFeature = {
  Discover: "save.discover",
  Export: "save.export",
  Import: "save.import",
  Convert: "save.convert",
  Store: "save.store",
  History: "save.history"
} as const;
export type SaveFeature = (typeof SaveFeature)[keyof typeof SaveFeature];
export const SavePort = {
  Discover: "save.discover",
  Export: "save.export",
  Import: "save.import",
  Convert: "save.convert",
  Store: "save.store",
  History: "save.history"
} as const;
export type SavePort = (typeof SavePort)[keyof typeof SavePort];
export const SaveOperation = {
  Discover: "discover",
  Export: "export",
  Import: "import",
  Convert: "convert",
  Put: "put",
  Open: "open",
  List: "list"
} as const;
export type SaveOperation = (typeof SaveOperation)[keyof typeof SaveOperation];

export const saveModule: ModuleDescriptor = {
  id: "konogame.save",
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  features: [
    {
      id: SaveFeature.Discover,
      port: SavePort.Discover,
      portVersion: SAVE_DISCOVER_PORT.version,
      operation: SaveOperation.Discover,
      requiredCapabilities: []
    },
    {
      id: SaveFeature.Export,
      port: SavePort.Export,
      portVersion: SAVE_EXPORT_PORT.version,
      operation: SaveOperation.Export,
      requiredCapabilities: [ArtifactCapability.Multifile, ArtifactCapability.Streaming]
    },
    {
      id: SaveFeature.Import,
      port: SavePort.Import,
      portVersion: SAVE_IMPORT_PORT.version,
      operation: SaveOperation.Import,
      requiredCapabilities: [ArtifactCapability.Multifile, ArtifactCapability.Streaming]
    },
    {
      id: SaveFeature.Convert,
      port: SavePort.Convert,
      portVersion: SAVE_CONVERT_PORT.version,
      operation: SaveOperation.Convert,
      requiredCapabilities: [ArtifactCapability.Multifile, ArtifactCapability.Streaming]
    },
    {
      id: SaveFeature.Store,
      port: SavePort.Store,
      portVersion: SAVE_STORE_PORT.version,
      operation: SaveOperation.Put,
      requiredCapabilities: [ArtifactCapability.Multifile, ArtifactCapability.Streaming]
    },
    {
      id: SaveFeature.History,
      port: SavePort.History,
      portVersion: SAVE_HISTORY_PORT.version,
      operation: SaveOperation.List,
      requiredCapabilities: [HistoryCapability.Versioned]
    }
  ]
};

export interface SaveDiscoverPort {
  discover(gameId: string): Effect.Effect<readonly string[], SaveError>;
}

export interface SaveExportPort {
  export(gameId: string): Effect.Effect<Artifact, SaveError>;
}

export interface SaveImportPort {
  import(gameId: string, artifact: Artifact): Effect.Effect<void, SaveError>;
}

export interface SaveConvertPort {
  convert(artifact: Artifact, targetMediaType: string): Effect.Effect<Artifact, SaveError>;
}

export interface SaveStorePort {
  put(artifact: Artifact): Effect.Effect<ArtifactReference, SaveError>;
  open(reference: ArtifactReference): Effect.Effect<Artifact, SaveError>;
}

export interface SaveHistoryPort {
  list(gameId: string): Effect.Effect<readonly ArtifactReference[], SaveError>;
}
