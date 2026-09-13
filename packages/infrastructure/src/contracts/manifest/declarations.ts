import { type } from "arktype";
import semver from "semver";
import { type LocationSupport, type LocationTypeDefinition } from "../location/contract.ts";
import {
  type ExternalSchema,
  isStandardSchema,
  toInternalSchema,
  toTransmittedSchema
} from "../schema/conversion.ts";
import { dataArray, dataRecord } from "../schema/data-input.ts";
import { DECLARATION_PROTOCOL_VERSION } from "../version.ts";

export type FeatureId = string;
export type PortId = string;
export type OperationId = string;
export type CapabilityId = string;

export interface Feature {
  id: FeatureId;
  port: PortId;
  portVersion: string;
  operation: OperationId;
  requiredCapabilities: readonly CapabilityId[];
}
export interface ModuleDescriptor {
  id: string;
  /** Declaration protocol compatibility, independent of every Port. */
  declarationProtocolRange: string;
  features: readonly Feature[];
}
export const AdapterOwnerKind = { Module: "module", Extension: "extension" } as const;
export type AdapterOwnerKind = (typeof AdapterOwnerKind)[keyof typeof AdapterOwnerKind];
export interface AdapterOwner {
  kind: AdapterOwnerKind;
  id: string;
}
export interface AdapterDescriptor {
  id: string;
  owner: AdapterOwner;
  port: PortId;
  /** Declaration protocol compatibility, independent of the implemented Port. */
  declarationProtocolRange: string;
  portVersionRange: string;
  operations: readonly OperationId[];
  capabilities: readonly CapabilityId[];
  priority?: number;
  locations?: readonly LocationSupport[];
}
export interface ContributionDeclarations {
  adapters?: readonly AdapterDescriptor[];
  locations?: readonly LocationTypeDefinition[];
}
export interface ModuleManifest extends ModuleDescriptor {
  activationEvents?: readonly string[];
  contributes?: ContributionDeclarations;
}
export interface ExtensionDescriptor {
  id: string;
  version: string;
  /** Declaration protocol compatibility, independent of Adapter Port ranges. */
  declarationProtocolRange: string;
  software: Readonly<Record<string, string>>;
  dependencies?: readonly { extensionId: string; versionRange: string }[];
  activationEvents?: readonly string[];
  contributes: ContributionDeclarations;
}
export type ExtensionManifest = ExtensionDescriptor;

function safeDeclaration(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value !== "object") {
    return typeof value !== "function";
  }
  if (ancestors.has(value)) {
    return false;
  }
  ancestors.add(value);
  try {
    const entries = Array.isArray(value)
      ? dataArray(value).map((item, index) => [String(index), item] as const)
      : Object.entries(dataRecord(value));
    for (const [key, item] of entries) {
      // Schemas are independently inspected and may be callable Standard Schema implementations.
      if (key !== "dataSchema" && !safeDeclaration(item, ancestors)) {
        return false;
      }
    }
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
  return true;
}
export function assertDeclarationInput(value: unknown): void {
  if (!safeDeclaration(value)) {
    throw new Error("Declarations require plain values without accessors or cycles");
  }
}
const declarationInputSchema = type.unknown.narrow(
  (value, ctx) =>
    safeDeclaration(value) ||
    ctx.reject({
      expected: "plain declaration values without accessors or cycles",
      actual: "unsafe declaration"
    })
);

export const declarationIdSchema = type.string.narrow(
  (value, ctx) => value.trim().length > 0 || ctx.mustBe("a nonempty ID")
);
export const semverRangeSchema = type.string.narrow(
  (value, ctx) => semver.validRange(value) !== null || ctx.mustBe("a SemVer range")
);
export const semverVersionSchema = type.string.narrow((value, ctx) => {
  const parsed = semver.parse(value);
  const canonical =
    parsed && `${parsed.version}${parsed.build.length ? `+${parsed.build.join(".")}` : ""}`;
  return canonical === value || ctx.mustBe("a canonical SemVer version");
});
export function supportsDeclarationProtocolRange(range: string): boolean {
  return (
    !(semverRangeSchema(range) instanceof type.errors) &&
    semver.satisfies(DECLARATION_PROTOCOL_VERSION, range)
  );
}

const uniqueIdsSchema = declarationIdSchema
  .array()
  .narrow((values, ctx) => new Set(values).size === values.length || ctx.mustBe("unique IDs"));
const activationEventsSchema = type.string
  .matching(/^(?:onStartup|on(?:Feature|Port|Location):[^\s]+)$/)
  .array()
  .narrow(
    (values, ctx) =>
      new Set(values).size === values.length || ctx.mustBe("unique activation events")
  );
const locationTypeSchema = type.string.matching(/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/);
const locationSupportSchema = type({
  "+": "reject",
  type: locationTypeSchema,
  schemaRange: semverRangeSchema
});
function isJsonSchemaObject(value: unknown): value is Record<string, never> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    const visit = (item: unknown, ancestors: Set<object>): boolean => {
      if (item === null || typeof item === "string" || typeof item === "boolean") {
        return true;
      }
      if (typeof item === "number") {
        return Number.isFinite(item);
      }
      if (typeof item !== "object" || ancestors.has(item)) {
        return false;
      }
      const prototype = Object.getPrototypeOf(item);
      if (
        Array.isArray(item)
          ? prototype !== Array.prototype
          : prototype !== Object.prototype && prototype !== null
      ) {
        return false;
      }
      ancestors.add(item);
      const descriptors = Object.getOwnPropertyDescriptors(item);
      const valid = Reflect.ownKeys(item).every((key) => {
        if (Array.isArray(item) && key === "length") {
          return true;
        }
        if (typeof key !== "string") {
          return false;
        }
        const descriptor = descriptors[key];
        return (
          descriptor !== undefined &&
          descriptor.enumerable === true &&
          "value" in descriptor &&
          visit(descriptor.value, ancestors)
        );
      });
      ancestors.delete(item);
      return valid;
    };
    return visit(value, new Set());
  } catch {
    return false;
  }
}
const externalSchema = type.unknown.pipe((value, ctx) => {
  if (!isStandardSchema(value) && typeof value !== "boolean" && !isJsonSchemaObject(value)) {
    return ctx.reject({
      expected: "a valid Standard Schema or JSON Schema",
      actual: "invalid schema"
    });
  }
  try {
    const transmitted = toTransmittedSchema(toInternalSchema(value as ExternalSchema));
    // Predicate fallbacks may produce only a dialect marker; use the unconstrained document.
    const portable = Object.keys(transmitted).every((key) => key === "$schema") ? {} : transmitted;
    // Validate the projection itself without executing the supplied schema a second time.
    toInternalSchema(portable);
    return portable;
  } catch {
    return ctx.reject({
      expected: "a portable Standard Schema or JSON Schema",
      actual: "invalid schema"
    });
  }
});
export const locationTypeDefinitionSchema = type({
  "+": "reject",
  type: locationTypeSchema,
  schemaVersion: semverVersionSchema,
  schemaRange: semverRangeSchema,
  dataSchema: externalSchema
}).narrow(
  (value, ctx) =>
    semver.satisfies(value.schemaVersion, value.schemaRange) ||
    ctx.mustBe("a Location schema version inside its range")
);
const featureFields = type({
  "+": "reject",
  id: declarationIdSchema,
  port: declarationIdSchema,
  portVersion: semverVersionSchema,
  operation: declarationIdSchema,
  requiredCapabilities: uniqueIdsSchema
});
export const featureSchema = declarationInputSchema.pipe(featureFields);
const adapterDescriptorFields = type({
  "+": "reject",
  id: declarationIdSchema,
  owner: {
    "+": "reject",
    kind: type.enumerated(...Object.values(AdapterOwnerKind)),
    id: declarationIdSchema
  },
  port: declarationIdSchema,
  declarationProtocolRange: semverRangeSchema,
  portVersionRange: semverRangeSchema,
  operations: uniqueIdsSchema,
  capabilities: uniqueIdsSchema,
  "priority?": type.number.narrow(
    (value, ctx) => Number.isFinite(value) || ctx.mustBe("a finite priority")
  ),
  "locations?": locationSupportSchema
    .array()
    .narrow(
      (values, ctx) =>
        new Set(values.map((value) => value.type)).size === values.length ||
        ctx.mustBe("unique Location support types")
    )
});
export const adapterDescriptorSchema = declarationInputSchema.pipe(adapterDescriptorFields);
const declarationsSchema = type({
  "+": "reject",
  "adapters?": adapterDescriptorFields.array(),
  "locations?": locationTypeDefinitionSchema.array()
});
const dependencySchema = type({
  "+": "reject",
  extensionId: declarationIdSchema,
  versionRange: semverRangeSchema
});
const softwareRangeSchema = type.string.narrow(
  (value, ctx) =>
    value === "latest" ||
    value === "generic" ||
    semver.validRange(value) !== null ||
    ctx.mustBe("a SemVer range, latest, or generic")
);
const moduleManifestFields = type({
  "+": "reject",
  id: declarationIdSchema,
  declarationProtocolRange: semverRangeSchema,
  features: featureFields
    .array()
    .narrow(
      (values, ctx) =>
        new Set(values.map((value) => value.id)).size === values.length ||
        ctx.mustBe("unique Feature IDs")
    ),
  "activationEvents?": activationEventsSchema,
  "contributes?": declarationsSchema
});
const extensionManifestFields = type({
  "+": "reject",
  id: declarationIdSchema,
  version: semverVersionSchema,
  declarationProtocolRange: semverRangeSchema,
  software: type({ "[string]": softwareRangeSchema }).narrow(
    (values, ctx) =>
      (!Array.isArray(values) && Object.keys(values).every((key) => key.trim().length > 0)) ||
      ctx.mustBe("nonempty software IDs")
  ),
  "dependencies?": dependencySchema
    .array()
    .narrow(
      (values, ctx) =>
        new Set(values.map((value) => value.extensionId)).size === values.length ||
        ctx.mustBe("unique Extension dependencies")
    ),
  "activationEvents?": activationEventsSchema,
  contributes: declarationsSchema
});

export const moduleManifestSchema = declarationInputSchema.pipe(moduleManifestFields);
export const extensionManifestSchema = declarationInputSchema.pipe(extensionManifestFields);

export function parseModuleManifest(value: unknown): ModuleManifest {
  assertDeclarationInput(value);
  return moduleManifestFields.assert(value);
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  assertDeclarationInput(value);
  return extensionManifestFields.assert(value);
}
