import { uuidSchema } from "@konogame/workspace";
import { type Type, type } from "arktype";

const digest = type.string.matching(/^[0-9a-f]{64}$/);
const snapshotRevision = type.string.matching(/^sha256:[0-9a-f]{64}$/);

export const writerLockSchema = type({
  "+": "reject",
  pid: type("number.integer >= 1").narrow(
    (value, ctx) => Number.isSafeInteger(value) || ctx.mustBe("a safe process id")
  ),
  token: type.string.atLeastLength(1)
});
export const operationReceiptSchema = type({
  "+": "reject",
  requestHash: digest
});
export const importJournalSchema = type({
  "+": "reject",
  version: type.unit(1),
  operationId: uuidSchema,
  expectedRevision: snapshotRevision,
  requestHash: digest,
  entries: type({
    "+": "reject",
    path: type.string,
    content: type.string
  })
    .array()
    .atLeastLength(1)
    .atMostLength(10_000),
  before: type({
    "+": "reject",
    path: type.string,
    hash: digest
  }).array()
});
export type ImportJournal = (typeof importJournalSchema)["infer"];
export const initializeJournalSchema = type({
  "+": "reject",
  version: type.unit(1),
  input: type({
    "+": "reject",
    operationId: uuidSchema,
    workspace: type.unknown,
    host: type.unknown
  })
});
export const editJournalSchema = type({
  "+": "reject",
  version: type.unit(1),
  input: type({
    "+": "reject",
    operationId: uuidSchema,
    expectedRevision: type.string.atLeastLength(1),
    change: type.unknown
  }),
  path: type.string,
  "before?": type.string,
  after: type.string,
  documents: type({
    "+": "reject",
    path: type.string,
    hash: digest
  })
    .array()
    .narrow(
      (documents, ctx) =>
        new Set(documents.map((document) => document.path)).size === documents.length ||
        ctx.mustBe("unique edit base documents")
    )
});
export const renameRecoverySchema = type({
  "+": "reject",
  version: type.unit(1),
  recordId: uuidSchema,
  uniformName: type.string.atLeastLength(1),
  operationId: uuidSchema,
  expectedRevision: type.string.atLeastLength(1),
  before: type.string,
  after: type.string,
  from: type.string,
  to: type.string,
  temporary: type.string,
  moves: type({
    "+": "reject",
    from: type.string,
    to: type.string,
    via: type.string
  }).array(),
  beforeDocuments: type({
    "+": "reject",
    path: type.string,
    hash: digest
  }).array()
});
export type RenameRecovery = (typeof renameRecoverySchema)["infer"];

export function accept<T>(schema: Type<T>, value: unknown): T | undefined {
  const parsed = schema(value);
  if (parsed instanceof type.errors) {
    return undefined;
  }
  return parsed as T;
}
