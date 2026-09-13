import { type JsonSchema, scope, type Type, type } from "arktype";
import { Data, type Effect } from "effect";
import { type ExternalSchema, implementationSchema } from "../schema/conversion.ts";

export class LocationError extends Data.TaggedError("LocationError")<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ConfigurationValue =
  | string
  | number
  | boolean
  | ConfigurationValue[]
  | { [key: string]: ConfigurationValue };

// @ark/json-schema cannot compile a recursive `$ref` document, and embedding its compiled number
// node in this union crashes ArkType 2.2.8 branch reduction. The safe-integer bound lives here;
// toJsonSchema still emits minimum and maximum. TOML parsing rejects dates before this schema.
// Canonical SemVer, including build metadata. The pattern is the schema; semver.parse does not convert.
const canonicalSemver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const locationTypeName = type.string.matching(/^[a-z][a-z0-9]*(?:[.:-][a-z0-9]+)*$/);
const configurationValues = scope({
  locationTypeName,
  schemaVersion: type.string.matching(canonicalSemver),
  configurationNumber: type.number
    .atLeast(-Number.MAX_SAFE_INTEGER)
    .atMost(Number.MAX_SAFE_INTEGER),
  configurationObject: { "[string]": "configurationValue" },
  configurationValue:
    "string | boolean | configurationNumber | configurationValue[] | configurationObject",
  locationContract: {
    "+": "reject",
    type: "locationTypeName",
    schemaVersion: "schemaVersion",
    data: "configurationValue"
  }
}).export();
export const configurationValueSchema =
  configurationValues.configurationValue as unknown as Type<ConfigurationValue>;
export const configurationValueJsonSchema = configurationValueSchema.toJsonSchema({
  target: "draft-2020-12"
}) as JsonSchema;

export interface LocationContract {
  type: string;
  schemaVersion: string;
  data: ConfigurationValue;
}
export const locationContractSchema =
  configurationValues.locationContract as unknown as Type<LocationContract>;

export const LocationTypeStatus = {
  Supported: "supported",
  Unverified: "unverified"
} as const;
export type LocationTypeStatus = (typeof LocationTypeStatus)[keyof typeof LocationTypeStatus];

export interface LocationTypeDefinition {
  type: string;
  schemaVersion: string;
  schemaRange: string;
  dataSchema: ExternalSchema;
}
export interface LocationSupport {
  type: string;
  schemaRange: string;
}
export interface ResourceReference<T extends ConfigurationValue = ConfigurationValue> {
  type: string;
  schemaVersion: string;
  data: T;
}
export type LocationContext = Readonly<Record<string, ConfigurationValue>>;
export const LocationPortId = "location.behavior";
export const LocationFeature = {
  Validate: "location.validate",
  Compare: "location.compare",
  Resolve: "location.resolve"
} as const;
export type LocationFeature = (typeof LocationFeature)[keyof typeof LocationFeature];
export const LocationOperation = {
  Validate: "validate",
  Compare: "compare",
  Resolve: "resolve"
} as const;
export type LocationOperation = (typeof LocationOperation)[keyof typeof LocationOperation];
export const LocationValidationStatus = {
  Valid: "valid",
  Invalid: "invalid",
  Unverified: "unverified"
} as const;
export type LocationValidationStatus =
  (typeof LocationValidationStatus)[keyof typeof LocationValidationStatus];
export const LocationComparisonStatus = {
  Equal: "equal",
  Different: "different",
  Unknown: "unknown",
  Incomparable: "incomparable"
} as const;
export type LocationComparisonStatus =
  (typeof LocationComparisonStatus)[keyof typeof LocationComparisonStatus];
export const LocationResolutionStatus = {
  Resolved: "resolved",
  Unavailable: "unavailable"
} as const;
export type LocationResolutionStatus =
  (typeof LocationResolutionStatus)[keyof typeof LocationResolutionStatus];
export interface LocationValidationResult {
  status: LocationValidationStatus;
  reason?: string;
}
export interface LocationComparisonResult {
  status: LocationComparisonStatus;
  reason?: string;
}
export type LocationResolutionResult =
  | {
      status: typeof LocationResolutionStatus.Resolved;
      resource: ResourceReference;
    }
  | { status: typeof LocationResolutionStatus.Unavailable; reason: string };
export const LocationCapability = {
  Validate: "location.validation",
  Compare: "location.identity",
  Resolve: "location.resolve"
} as const;
export type LocationCapability = (typeof LocationCapability)[keyof typeof LocationCapability];

export interface LocationPort {
  validate?(input: {
    location: LocationContract;
    context?: LocationContext;
  }): Effect.Effect<LocationValidationResult, LocationError>;
  compare?(input: {
    left: LocationContract;
    right: LocationContract;
    context?: LocationContext;
  }): Effect.Effect<LocationComparisonResult, LocationError>;
  resolve?(input: {
    location: LocationContract;
    context?: LocationContext;
  }): Effect.Effect<LocationResolutionResult, LocationError>;
}
export interface ImplementationPort<T> {
  id: string;
  operations?: Readonly<Record<string, keyof T>>;
  is(value: unknown): value is T;
}
export const locationImplementation: ImplementationPort<LocationPort> = {
  id: LocationPortId,
  operations: {
    [LocationOperation.Validate]: "validate",
    [LocationOperation.Compare]: "compare",
    [LocationOperation.Resolve]: "resolve"
  },
  is: implementationSchema(Object.values(LocationOperation), "any")
};
