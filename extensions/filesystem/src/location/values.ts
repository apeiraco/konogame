import { type LocationContract, type LocationTypeDefinition } from "@konogame/contracts";

export const FilesystemLocationType = {
  Absolute: "fs.absolute",
  Relative: "fs.relative"
} as const;
export type FilesystemLocationType =
  (typeof FilesystemLocationType)[keyof typeof FilesystemLocationType];
export const FILESYSTEM_LOCATION_SCHEMA = "1.0.0";
export const filesystemLocationTypes: LocationTypeDefinition[] = [
  {
    type: FilesystemLocationType.Absolute,
    schemaVersion: FILESYSTEM_LOCATION_SCHEMA,
    schemaRange: FILESYSTEM_LOCATION_SCHEMA,
    dataSchema: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: { path: { type: "string", minLength: 1 } }
    }
  },
  {
    type: FilesystemLocationType.Relative,
    schemaVersion: FILESYSTEM_LOCATION_SCHEMA,
    schemaRange: FILESYSTEM_LOCATION_SCHEMA,
    dataSchema: {
      type: "object",
      additionalProperties: false,
      required: ["rootKey", "path"],
      properties: {
        rootKey: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 }
      }
    }
  }
];
export function absoluteFilesystemLocation(path: string): LocationContract {
  return {
    type: FilesystemLocationType.Absolute,
    schemaVersion: FILESYSTEM_LOCATION_SCHEMA,
    data: { path }
  };
}
export function relativeFilesystemLocation(rootKey: string, path: string): LocationContract {
  return {
    type: FilesystemLocationType.Relative,
    schemaVersion: FILESYSTEM_LOCATION_SCHEMA,
    data: { rootKey, path }
  };
}

