import { resolve } from "node:path";

export function repositoryRoot(): string {
  return resolve(import.meta.dirname, "../../..");
}
