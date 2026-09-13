import { type ImplementationPort, implementationSchema } from "@konogame/infrastructure/contracts";
import { Context } from "effect";
import { type GameDiscoveryPort, GameOperation, GamePort } from "./contract.ts";

export class GAME_DISCOVERY extends Context.Service<GAME_DISCOVERY, GameDiscoveryPort>()(
  GamePort.Discovery
) {}
export const gameDiscoveryImplementation: ImplementationPort<GameDiscoveryPort> = {
  id: GamePort.Discovery,
  operations: { [GameOperation.Discover]: "discover" },
  is: implementationSchema(["discover"])
};
