import { declarationIdSchema } from "@konogame/infrastructure/contracts";
import { type } from "arktype";
import { dataArray, dataRecord } from "../contracts/schema/data-input.ts";
import {
  type LifecycleDiagnostic,
  LifecyclePhase,
  lifecycleDiagnosticSchema
} from "./diagnostics.ts";

export interface DecodedDiscoveryBatch {
  complete: boolean;
  contributions: readonly unknown[];
  diagnostics: readonly LifecycleDiagnostic[];
  restartRequired: readonly string[];
}

const callable = type.unknown.narrow(
  (value, ctx): value is (...args: never[]) => unknown =>
    typeof value === "function" || ctx.mustBe("a function")
);
export const discoverySourceSchema = type({
  id: declarationIdSchema,
  discover: callable
});
const discoveryBatchSchema = type({
  "+": "reject",
  complete: "boolean",
  contributions: type.unknown,
  "diagnostics?": type.unknown,
  "restartRequired?": type.unknown
});
const batchKeys = discoveryBatchSchema.props.map((property) => property.key);
const diagnosticKeys = lifecycleDiagnosticSchema.props.map((property) => property.key);
export function decodeDiscoveryBatch(value: unknown): DecodedDiscoveryBatch {
  const batch = discoveryBatchSchema.assert(dataRecord(value, batchKeys));
  const complete = batch.complete;
  const contributions = dataArray(batch.contributions);
  const diagnostics: LifecycleDiagnostic[] = [];
  for (const value of batch.diagnostics === undefined ? [] : dataArray(batch.diagnostics)) {
    try {
      diagnostics.push(lifecycleDiagnosticSchema.assert(dataRecord(value, diagnosticKeys)));
    } catch {
      diagnostics.push({ phase: LifecyclePhase.Discovery, reason: "Invalid discovery diagnostic" });
    }
  }
  const restartRequired =
    batch.restartRequired === undefined
      ? []
      : declarationIdSchema.array().assert(dataArray(batch.restartRequired));
  return { complete, contributions, diagnostics, restartRequired };
}
