import { homedir } from "node:os";
import { join } from "node:path";
import { KonogameApplication } from "@konogame/application";
import {
  FilesystemSaveStore,
  FilesystemWorkspaceConfiguration,
  filesystemExtension,
  filesystemSaveStoreAdapter,
  filesystemWorkspaceConfigurationAdapter
} from "@konogame/extension-filesystem";
import { saveModule } from "@konogame/save";
import { workspaceModule } from "@konogame/workspace";

export function createLocalApplication(
  root = join(homedir(), ".konogame", "saves")
): KonogameApplication {
  return new KonogameApplication(
    [saveModule, workspaceModule],
    filesystemExtension.adapters,
    new Map([[filesystemSaveStoreAdapter.id, new FilesystemSaveStore(root)]]),
    new Map([[filesystemWorkspaceConfigurationAdapter.id, new FilesystemWorkspaceConfiguration()]])
  );
}
