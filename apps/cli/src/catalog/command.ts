import { FEATURE_PLAN } from "@konogame/infrastructure";
import { Effect } from "effect";
import { CLI_CONTEXT, type CliCommandEffect, CliError, output, required } from "../context.ts";
import { type CliCommand, CliCommandName } from "../parser/index.ts";

type CatalogCommand = Extract<
  CliCommand,
  { kind: typeof CliCommandName.features | typeof CliCommandName.plan }
>;

export function executeCatalog(command: CatalogCommand): CliCommandEffect {
  return Effect.gen(function* () {
    switch (command.kind) {
      case CliCommandName.features: {
        const context = yield* CLI_CONTEXT;
        const features = yield* (yield* FEATURE_PLAN).features();
        if (context.json) return yield* output(features);
        return yield* context.stdout(`${features.join("\n")}\n`);
      }
      case CliCommandName.plan: {
        const feature = yield* required(command.feature, "feature");
        if (command.adapter && command.adapterId && command.adapter !== command.adapterId)
          return yield* Effect.fail(new CliError({ message: "Conflicting Adapter preferences" }));
        const adapter = command.adapter ?? command.adapterId;
        return yield* output(
          yield* (yield* FEATURE_PLAN).plan(
            [feature],
            adapter === undefined ? {} : { [feature]: adapter }
          )
        );
      }
    }
  });
}
