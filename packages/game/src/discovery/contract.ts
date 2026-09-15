import {
  type ConfigurationValue,
  configurationValueSchema,
  DECLARATION_PROTOCOL_RANGE,
  locationContractSchema,
  type ModuleDescriptor
} from "@konogame/infrastructure/contracts";
import { externalIdentitySchema, token } from "@konogame/workspace/contracts";
import { type Type, type } from "arktype";
import { type Effect } from "effect";
import { GAME_DISCOVERY_PORT } from "../version.ts";
import { type GameDiscoveryError } from "./errors.ts";

export const GameFeature = { Discover: "game.discover" } as const;
export type GameFeature = (typeof GameFeature)[keyof typeof GameFeature];
export const GamePort = { Discovery: "game.discovery" } as const;
export type GamePort = (typeof GamePort)[keyof typeof GamePort];
export const GameOperation = { Discover: "discover" } as const;
export type GameOperation = (typeof GameOperation)[keyof typeof GameOperation];
export const GameCapability = {
  LocalDiscovery: "discovery.local",
  ScopedDiscovery: "discovery.scoped"
} as const;
export type GameCapability = (typeof GameCapability)[keyof typeof GameCapability];

export const DiscoveryDisposition = {
  NewGame: "new-game",
  ReuseGame: "reuse-game",
  ExistingInstallation: "existing-installation",
  Conflict: "conflict"
} as const;
export type DiscoveryDisposition = (typeof DiscoveryDisposition)[keyof typeof DiscoveryDisposition];
export const discoverySourceKindSchema = token;
export function discoverySourceCapability(sourceKind: string): string {
  return `discovery.source.${sourceKind}`;
}
const text = type.string.atLeastLength(1);
const scopeBytes = 262_144;
export type DiscoveryScope = { readonly [key: string]: ConfigurationValue };
export const discoveryScopeSchema = type.unknown.narrow((value, ctx): value is DiscoveryScope => {
  const parsed = configurationValueSchema(value);
  if (parsed instanceof type.errors) {
    return ctx.mustBe("a configuration value");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return ctx.mustBe("a scope object");
  }
  return JSON.stringify(parsed).length <= scopeBytes || ctx.mustBe("a bounded scope");
}) as Type<DiscoveryScope>;
export const discoveryEvidenceSchema = type({
  "+": "reject",
  kind: text,
  path: text,
  fingerprint: text
}).onDeepUndeclaredKey("reject");
export const discoveryExternalRefSchema = type({
  "+": "reject",
  authority: token,
  kind: token,
  key: type({ "+": "reject", "[/.+/]": text }).narrow(
    (value, ctx) => Object.keys(value).length > 0 || ctx.mustBe("a non-empty external key")
  )
}).onDeepUndeclaredKey("reject");
export const discoveryObservationSchema = type({
  "+": "reject",
  observationKey: text,
  title: text,
  location: locationContractSchema,
  externalRefs: discoveryExternalRefSchema.array(),
  "externalIdentities?": externalIdentitySchema.array(),
  evidence: discoveryEvidenceSchema.array().atLeastLength(1)
}).onDeepUndeclaredKey("reject");
export const discoveryDiagnosticSchema = type({
  "+": "reject",
  code: text,
  message: text,
  "path?": text
}).onDeepUndeclaredKey("reject");
export const gameDiscoveryInputSchema = type({
  "+": "reject",
  hostId: text,
  sourceId: token,
  sourceKind: discoverySourceKindSchema,
  scope: discoveryScopeSchema
}).onDeepUndeclaredKey("reject");
export const gameDiscoveryResultSchema = type({
  "+": "reject",
  observations: discoveryObservationSchema.array(),
  diagnostics: discoveryDiagnosticSchema.array()
}).onDeepUndeclaredKey("reject");
export type DiscoveryEvidence = (typeof discoveryEvidenceSchema)["infer"];
export type DiscoveryDiagnostic = (typeof discoveryDiagnosticSchema)["infer"];
export type DiscoveryObservation = (typeof discoveryObservationSchema)["infer"];
export type GameDiscoveryInput = (typeof gameDiscoveryInputSchema)["infer"];
export type GameDiscoveryResult = (typeof gameDiscoveryResultSchema)["infer"];
export interface GameDiscoveryPort {
  discover(input: GameDiscoveryInput): Effect.Effect<GameDiscoveryResult, GameDiscoveryError>;
}
export const gameModule: ModuleDescriptor = {
  id: "konogame.game",
  declarationProtocolRange: DECLARATION_PROTOCOL_RANGE,
  features: [
    {
      id: GameFeature.Discover,
      port: GamePort.Discovery,
      portVersion: GAME_DISCOVERY_PORT.version,
      operation: GameOperation.Discover,
      requiredCapabilities: [GameCapability.LocalDiscovery, GameCapability.ScopedDiscovery]
    }
  ]
};
