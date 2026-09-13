export const HistoryCapability = {
  Versioned: "history.versioned",
  IdempotentRecord: "history.idempotent-record"
} as const;
export type HistoryCapability = (typeof HistoryCapability)[keyof typeof HistoryCapability];
