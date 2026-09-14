import {
  ActivationStatus,
  ImplementationState,
  lifecycleDiagnosticSchema,
  RegistrationStatus
} from "@konogame/infrastructure";
import {
  AdapterOwnerKind,
  adapterDescriptorSchema,
  extensionManifestSchema,
  toTransmittedSchema
} from "@konogame/infrastructure/contracts";
import { type } from "arktype";

const generation = type("number.integer >= 0");
const activation = type.enumerated(...Object.values(ActivationStatus));
const snapshot = type({
  catalogVersion: generation,
  generation,
  id: "string",
  owner: { kind: type.unit(AdapterOwnerKind.Extension), id: "string" },
  manifest: extensionManifestSchema.out,
  registration: type.unit(RegistrationStatus.Registered),
  activation,
  "reason?": "string",
  "diagnostics?": "string[]"
});
const adapter = type({
  catalogVersion: generation,
  generation,
  descriptor: adapterDescriptorSchema.out,
  contributionId: "string",
  implementationState: type.enumerated(...Object.values(ImplementationState)),
  activation
});
export const extensionListSchema = toTransmittedSchema(snapshot.array());
export const catalogStatusSchema = toTransmittedSchema(
  type({
    catalogVersion: generation,
    sources: type({ id: "string", contributionIds: "string[]" }).array(),
    extensions: snapshot.array(),
    adapters: adapter.array(),
    diagnostics: lifecycleDiagnosticSchema.array()
  })
);
export const catalogRefreshSchema = toTransmittedSchema(
  type({
    status: type.enumerated(...Object.values(RegistrationStatus)),
    catalogVersion: generation,
    sourceIds: "string[]",
    added: "string[]",
    unchanged: "string[]",
    replaced: "string[]",
    removed: "string[]",
    restartRequired: "string[]",
    diagnostics: lifecycleDiagnosticSchema.array()
  })
);
