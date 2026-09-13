import {
  type AdapterOwner,
  type AdapterOwnerKind,
  type ExtensionManifest,
  type ModuleManifest
} from "@konogame/infrastructure/contracts";
import { type ExtensionLoader } from "./activation-contract.ts";

export const ReloadPolicy = { RestartAfterLoad: "restart-after-load" } as const;

export type ReloadPolicy = (typeof ReloadPolicy)[keyof typeof ReloadPolicy];

export type Contribution =
  | {
      id?: string;
      kind: typeof AdapterOwnerKind.Extension;
      manifest: ExtensionManifest;
      load: ExtensionLoader;
      revision?: string;
      reloadPolicy?: ReloadPolicy;
    }
  | {
      id?: string;
      kind: typeof AdapterOwnerKind.Module;
      manifest: ModuleManifest;
      load: ExtensionLoader;
      revision?: string;
      reloadPolicy?: ReloadPolicy;
    };

export function contributionId(contribution: Contribution): string {
  return contribution.id ?? contribution.manifest.id;
}

export function contributionOwner(contribution: Contribution): AdapterOwner {
  return { kind: contribution.kind, id: contribution.manifest.id };
}
