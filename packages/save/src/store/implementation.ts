import { type ImplementationPort, implementationSchema } from "@konogame/infrastructure/contracts";
import { Context } from "effect";
import { SaveOperation, SavePort, type SaveStorePort } from "../contract/ports.ts";

export class SAVE_STORE extends Context.Service<SAVE_STORE, SaveStorePort>()(SavePort.Store) {}
export const saveStoreImplementation: ImplementationPort<SaveStorePort> = {
  id: SavePort.Store,
  operations: { [SaveOperation.Put]: "put", [SaveOperation.Open]: "open" },
  is: implementationSchema(["put", "open"])
};
