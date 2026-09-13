import { Context } from "effect";
import { type WorkspaceImportFileSystem } from "../operations/import.ts";
import { type WorkspaceManagementFileSystem } from "../operations/management.ts";

export class WORKSPACE_MANAGEMENT_FILESYSTEM extends Context.Service<
  WORKSPACE_MANAGEMENT_FILESYSTEM,
  WorkspaceManagementFileSystem
>()("workspace-toml.management-filesystem") {}

export class WORKSPACE_IMPORT_FILESYSTEM extends Context.Service<
  WORKSPACE_IMPORT_FILESYSTEM,
  WorkspaceImportFileSystem
>()("workspace-toml.import-filesystem") {}
