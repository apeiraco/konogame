import {
  AdapterOwnerKind,
  declarationIdSchema,
  parseExtensionManifest,
  parseModuleManifest
} from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import { dataArray, dataRecord } from "../contracts/schema/data-input.ts";
import { type Contribution, contributionId, ReloadPolicy } from "./contribution.ts";

export interface ContributionIdentity {
  id?: string;
  kind?: AdapterOwnerKind;
}

export function identifyContribution(value: unknown): ContributionIdentity {
  try {
    const own = Object.getOwnPropertyDescriptors(value as object);
    const kind = type.enumerated(...Object.values(AdapterOwnerKind))(own.kind?.value);
    const manifest = own.manifest?.value;
    let manifestId: unknown;
    try {
      manifestId = Object.getOwnPropertyDescriptor(manifest as object, "id")?.value;
    } catch {
      manifestId = undefined;
    }
    const id = declarationIdSchema(own.id?.value ?? manifestId);
    return {
      ...(id instanceof type.errors ? {} : { id }),
      ...(kind instanceof type.errors ? {} : { kind })
    };
  } catch {
    return {};
  }
}

const callable = type.unknown.narrow(
  (value, ctx): value is (...args: never[]) => unknown =>
    typeof value === "function" || ctx.mustBe("a function")
);
const contributionFields = type({
  "+": "reject",
  "id?": declarationIdSchema,
  kind: type.enumerated(AdapterOwnerKind.Module, AdapterOwnerKind.Extension),
  manifest: type.unknown,
  load: callable,
  "revision?": declarationIdSchema,
  "reloadPolicy?": type.unit(ReloadPolicy.RestartAfterLoad)
});
const contributionKeys = contributionFields.props.map((property) => property.key);

export const ContributionInputStatus = { Accepted: "accepted", Rejected: "rejected" } as const;
export type ContributionInputResult =
  | { status: typeof ContributionInputStatus.Accepted; contribution: Contribution }
  | {
      status: typeof ContributionInputStatus.Rejected;
      identity: ContributionIdentity;
      cause: unknown;
      fatal: boolean;
    };

export function decodeContribution(value: unknown): ContributionInputResult {
  let contribution: Contribution;
  try {
    const fields = contributionFields.assert(dataRecord(value, contributionKeys));
    contribution = {
      ...fields,
      manifest:
        fields.kind === AdapterOwnerKind.Extension
          ? parseExtensionManifest(fields.manifest)
          : parseModuleManifest(fields.manifest)
    } as Contribution;
  } catch (cause) {
    return {
      status: ContributionInputStatus.Rejected,
      identity: identifyContribution(value),
      cause,
      fatal: false
    };
  }
  try {
    if (
      contribution.kind === AdapterOwnerKind.Extension &&
      contributionId(contribution) !== contribution.manifest.id
    ) {
      throw new Error("Extension contribution ID must equal its manifest ID");
    }
    if (
      contribution.kind === AdapterOwnerKind.Module &&
      contribution.manifest.contributes?.locations?.length
    ) {
      throw new Error("Location types must be contributed by an Extension");
    }
    const manifest = structuredClone({
      ...contribution.manifest,
      contributes: {
        ...contribution.manifest.contributes,
        locations: contribution.manifest.contributes?.locations ?? []
      }
    });
    return {
      status: ContributionInputStatus.Accepted,
      contribution: { ...contribution, manifest } as Contribution
    };
  } catch (cause) {
    return {
      status: ContributionInputStatus.Rejected,
      identity: identifyContribution(contribution),
      cause,
      fatal: contribution.kind === AdapterOwnerKind.Module
    };
  }
}

export function parseContribution(value: unknown): Contribution {
  const result = decodeContribution(value);
  if (result.status === ContributionInputStatus.Rejected) {
    throw result.cause;
  }
  return result.contribution;
}

export function contributionItems(value: unknown): readonly unknown[] {
  return dataArray(value);
}

export function contributionIdentities(value: unknown): readonly string[] {
  try {
    return contributionItems(value).flatMap((item) => {
      const id = identifyContribution(item).id;
      return id ? [id] : [];
    });
  } catch {
    return [];
  }
}
