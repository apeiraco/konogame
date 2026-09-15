import { developerMessages } from "../../developer/openapi/messages.ts";
import { discoveryMessages } from "../../game/discovery/messages.ts";
import { libraryMessages } from "../../game/library/messages.ts";
import { shellMessages } from "../../layouts/messages.ts";
import { workspaceMessages } from "../../workspace/messages.ts";
import { commonMessages } from "./messages.ts";

export const resources = {
  en: {
    common: commonMessages.en,
    shell: shellMessages.en,
    workspace: workspaceMessages.en,
    developer: developerMessages.en,
    library: libraryMessages.en,
    discovery: discoveryMessages.en
  },
  "zh-CN": {
    common: commonMessages["zh-CN"],
    shell: shellMessages["zh-CN"],
    workspace: workspaceMessages["zh-CN"],
    developer: developerMessages["zh-CN"],
    library: libraryMessages["zh-CN"],
    discovery: discoveryMessages["zh-CN"]
  }
} as const;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    keySeparator: false;
    returnNull: false;
    strictKeyChecks: true;
    resources: typeof resources.en;
  }
}
