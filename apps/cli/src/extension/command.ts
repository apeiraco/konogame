import { EXTENSION_CATALOG } from "@konogame/infrastructure";
import { Effect } from "effect";
import { type CliCommandEffect, output } from "../context.ts";
import { type CliCommand, CliCommandName } from "../parser/index.ts";

type ExtensionCommand = Extract<
  CliCommand,
  {
    kind:
      | typeof CliCommandName.extensionList
      | typeof CliCommandName.extensionStatus
      | typeof CliCommandName.extensionRefresh;
  }
>;

export function executeExtension(command: ExtensionCommand): CliCommandEffect {
  return Effect.gen(function* () {
    const catalog = yield* EXTENSION_CATALOG;
    switch (command.kind) {
      case CliCommandName.extensionList:
        return yield* output(yield* catalog.list());
      case CliCommandName.extensionStatus:
        return yield* output(yield* catalog.status(command.id));
      case CliCommandName.extensionRefresh:
        return yield* output(yield* catalog.refresh());
    }
  });
}
