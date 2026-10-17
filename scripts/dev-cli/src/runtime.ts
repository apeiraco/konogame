import { AsyncLocalStorage } from "node:async_hooks";

export const outputContext = new AsyncLocalStorage<(text: string) => void>();
