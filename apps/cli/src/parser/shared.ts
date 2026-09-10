import { HostPlatform, hostSchema } from "@konogame/workspace";
import { command, constant, type NonEmptyString, object, option, string } from "@optique/core";
import { message } from "@optique/core/message";
import { type Parser } from "@optique/core/parser";
import { standardSchema } from "@optique/standard-schema";

export const text = (metavar: NonEmptyString) => string({ metavar });
export const platform = standardSchema(hostSchema.get("platform"), {
  metavar: "PLATFORM",
  // Phase-one stand-in; the Host record schema already constrains the real values.
  placeholder: HostPlatform.Windows
});

export const common = {
  json: option("--json", { description: message`Write machine readable JSON without prompts` }),
  interactive: option("--interactive", {
    description: message`Enable interactive prompts on a terminal`
  }),
  nonInteractive: option("--non-interactive", { description: message`Disable interactive prompts` })
};
export const adapter = option("--adapter", text("ADAPTER"), {
  description: message`Require this Adapter ID`
}).optional();

export function leaf<
  const K extends string,
  T extends Record<string, Parser<"sync", unknown, unknown>>
>(name: string, brief: string, kind: K, fields: T) {
  return command(name, object({ kind: constant(kind), ...common, ...fields }), {
    brief: message`${brief}`
  });
}
