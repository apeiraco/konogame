import { type ImplementationPort, implementationSchema } from "@konogame/infrastructure/contracts";
import { Context } from "effect";
import { WorkspaceOperation, WorkspacePort } from "../model/vocabulary.ts";
import {
  type ConfigurationHistoryPort,
  type WorkspaceConfigurationPort,
  type WorkspaceLocationBrowserPort
} from "./contracts.ts";

export class WORKSPACE_CONFIGURATION extends Context.Service<
  WORKSPACE_CONFIGURATION,
  WorkspaceConfigurationPort
>()(WorkspacePort.Configuration) {}
export class CONFIGURATION_HISTORY extends Context.Service<
  CONFIGURATION_HISTORY,
  ConfigurationHistoryPort
>()(WorkspacePort.History) {}
export const workspaceConfigurationImplementation: ImplementationPort<WorkspaceConfigurationPort> =
  {
    id: WorkspacePort.Configuration,
    operations: {
      [WorkspaceOperation.Initialize]: "initialize",
      [WorkspaceOperation.RecoverInitialize]: "recoverInitialize",
      [WorkspaceOperation.Edit]: "edit",
      [WorkspaceOperation.RecoverEdit]: "recoverEdit",
      [WorkspaceOperation.Read]: "read",
      [WorkspaceOperation.Rename]: "rename",
      [WorkspaceOperation.Import]: "import",
      [WorkspaceOperation.RecoverImport]: "recoverImport",
      [WorkspaceOperation.Probe]: "probe"
    },
    is: implementationSchema(["read"])
  };
export const configurationHistoryImplementation: ImplementationPort<ConfigurationHistoryPort> = {
  id: WorkspacePort.History,
  operations: {
    [WorkspaceOperation.List]: "list",
    [WorkspaceOperation.Read]: "read",
    [WorkspaceOperation.Record]: "record",
    [WorkspaceOperation.FindOperation]: "findOperation"
  },
  is: implementationSchema(["list", "read", "record", "findOperation"])
};
export class WORKSPACE_LOCATION_BROWSER extends Context.Service<
  WORKSPACE_LOCATION_BROWSER,
  WorkspaceLocationBrowserPort
>()(WorkspacePort.LocationBrowser) {}
export const workspaceLocationBrowserImplementation: ImplementationPort<WorkspaceLocationBrowserPort> =
  {
    id: WorkspacePort.LocationBrowser,
    operations: { [WorkspaceOperation.List]: "list" },
    is: implementationSchema(["list"])
  };
