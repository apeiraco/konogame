#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { CORE_VERSION } from "@konogame/contracts";
import {
  installedExtensionFileSystemLayer,
  nodeInstalledExtensionsSource,
  parseExtensionRoots
} from "@konogame/extension-discovery-node";
import { filesystemExtensionSource } from "@konogame/extension-filesystem/providers";
import { steamExtensionSource } from "@konogame/extension-steam/providers";
import { gameModuleSource } from "@konogame/game";
import { GAME_ADMISSION, provideGameAdmission } from "@konogame/game/admission";
import {
  EXTENSION_CATALOG,
  EXTENSION_LIFECYCLE,
  type ExtensionDiscoverySource,
  FEATURE_PLAN,
  ID_SERVICE,
  type InfrastructureSettings,
  provideExtensionCatalog,
  provideFeaturePlan,
  provideIdService,
  provideInfrastructure
} from "@konogame/infrastructure";
import { saveModuleSource } from "@konogame/save";
import { provideSaveStoreWorkflow, SAVE_STORE_WORKFLOW } from "@konogame/save/store";
import { workspaceModuleSource } from "@konogame/workspace";
import { provideWorkspaceManagement, WORKSPACE_MANAGEMENT } from "@konogame/workspace/management";
import { tomlWorkspaceConfigurationSource } from "@konogame/workspace-configuration/providers";
import { runAsync } from "@optique/run";
import {
  Cause,
  Config,
  ConfigProvider,
  Context,
  Effect,
  Layer,
  Logger,
  Option,
  Runtime
} from "effect";
import { executeCli, executeWorkspaceSchema } from "./command.ts";
import {
  Cancelled,
  CLI_CONTEXT,
  CLI_PROMPTS,
  CliError,
  type CliServices,
  cliChecked,
  interactionFlags,
  interactionPolicy,
  terminalPrompts
} from "./context.ts";
import { cliCommandMenu, cliParser, normalizeCliTokens } from "./parser/index.ts";

class RunnerStop {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}

export { Cancelled, CLI_PROMPTS, interactionPolicy, type Prompts } from "./context.ts";

export interface CliOptions<Error = never> {
  readonly overrides?: Layer.Layer<never, Error>;
  readonly env?: NodeJS.ProcessEnv;
  readonly isTTY?: boolean;
  readonly stdout?: (text: string) => void;
  readonly stderr?: (text: string) => void;
}

export function composeCli<Error = never>(
  options: {
    readonly saveRoot?: string;
    readonly extensionRoots?: readonly string[];
    readonly catalogOnly?: boolean;
    readonly coreOptions?: InfrastructureSettings;
    readonly discoverySources?: readonly ExtensionDiscoverySource[];
    readonly overrides?: Layer.Layer<never, Error>;
  } = {}
) {
  const overrides = options.overrides ?? Layer.empty;
  const dependencies = Layer.merge(installedExtensionFileSystemLayer, overrides);
  return Layer.unwrap(
    Effect.gen(function* () {
      const installed = options.extensionRoots?.length
        ? [yield* nodeInstalledExtensionsSource({ roots: options.extensionRoots })]
        : [];
      const infrastructure = provideInfrastructure(options.coreOptions, [
        saveModuleSource(),
        gameModuleSource(),
        workspaceModuleSource(),
        tomlWorkspaceConfigurationSource(),
        filesystemExtensionSource({
          saveRoot: options.saveRoot ?? join(homedir(), ".konogame", "saves")
        }),
        steamExtensionSource(),
        ...installed,
        ...(options.discoverySources ?? [])
      ]).pipe(Layer.provideMerge(overrides));
      const plans = Layer.mergeAll(provideFeaturePlan(), provideExtensionCatalog()).pipe(
        Layer.provideMerge(infrastructure)
      );
      return Layer.mergeAll(
        provideWorkspaceManagement(),
        provideGameAdmission(),
        provideSaveStoreWorkflow()
      ).pipe(
        Layer.provideMerge(plans),
        Layer.tap((services) => {
          const lifecycle = Context.get(services, EXTENSION_LIFECYCLE);
          return options.catalogOnly ? lifecycle.prepare() : lifecycle.initialize();
        })
      );
    })
  ).pipe(Layer.provideMerge(dependencies));
}

function errorMessage(error: unknown): string {
  if (error instanceof AggregateError)
    return `${error.message}: ${error.errors.map(errorMessage).join("; ")}`;
  return error instanceof Error ? error.message : String(error);
}

export function runCli<Error = never>(argv: string[], options: CliOptions<Error> = {}) {
  const stdout =
    options.stdout ??
    ((text: string) => {
      process.stdout.write(text);
    });
  const stderr =
    options.stderr ??
    ((text: string) => {
      process.stderr.write(text);
    });
  const env = options.env ?? process.env;
  return Effect.scoped(
    Effect.gen(function* () {
      const overrides = yield* Layer.build(options.overrides ?? Layer.empty);
      const policy = yield* cliChecked(
        interactionPolicy,
        argv,
        env,
        options.isTTY ??
          Boolean(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY)
      );
      const io = {
        ...policy,
        prompts: Context.getOrElse(overrides, CLI_PROMPTS, () => terminalPrompts),
        stdout: (text: string) =>
          Effect.sync(() => {
            stdout(text);
          }),
        stderr: (text: string) =>
          Effect.sync(() => {
            stderr(text);
          })
      };
      const leading: string[] = [];
      let args = [...argv];
      while (args.length && interactionFlags.includes(args[0]!)) leading.push(args.shift()!);
      if (!args.length) {
        if (policy.json)
          return yield* Effect.fail(new CliError({ message: "A command is required with --json" }));
        if (policy.interactive) {
          const selected = yield* io.prompts.select(
            "Choose a command",
            cliCommandMenu.map((id) => ({ value: id, label: id }))
          );
          args = [...selected.split(" "), ...leading];
        } else args = ["--help"];
      } else {
        const boundary = args.indexOf("--");
        args.splice(boundary < 0 ? args.length : boundary, 0, ...leading);
      }
      const services = Context.make(CLI_CONTEXT, io);
      const ids = yield* Layer.build(
        provideIdService(Context.getOrUndefined(overrides, ID_SERVICE))
      );
      const baseServices = Context.merge(Context.merge(services, ids), overrides);
      const parsed = yield* Effect.promise(async () => {
        try {
          const value = await runAsync(cliParser, {
            programName: "konogame",
            args: normalizeCliTokens(args),
            stdout: (text) => stdout(text.endsWith("\n") ? text : `${text}\n`),
            stderr: (text) => stderr(text.endsWith("\n") ? text : `${text}\n`),
            help: { option: { names: ["-h", "--help"] } },
            version: { value: CORE_VERSION, option: { names: ["-v", "--version"] } },
            completion: "both",
            onExit: (code): never => {
              throw new RunnerStop(code);
            }
          });
          return { stopped: false as const, value };
        } catch (error) {
          if (error instanceof RunnerStop) return { stopped: true as const, code: error.code };
          throw error;
        }
      });
      if (parsed.stopped) return parsed.code;
      const command = parsed.value;
      if (command.kind === "workspace schema") {
        yield* executeWorkspaceSchema().pipe(Effect.provideContext(baseServices));
        return 0;
      }
      const saveRoot = Option.getOrUndefined(
        yield* Config.option(Config.String("KONOGAME_SAVE_ROOT"))
      );
      const extensionRoots = yield* cliChecked(
        parseExtensionRoots,
        Option.getOrUndefined(yield* Config.option(Config.String("KONOGAME_EXTENSION_ROOTS")))
      );
      const injected =
        Context.getOrUndefined(overrides, FEATURE_PLAN) !== undefined ||
        Context.getOrUndefined(overrides, EXTENSION_CATALOG) !== undefined ||
        Context.getOrUndefined(overrides, WORKSPACE_MANAGEMENT) !== undefined ||
        Context.getOrUndefined(overrides, GAME_ADMISSION) !== undefined ||
        Context.getOrUndefined(overrides, SAVE_STORE_WORKFLOW) !== undefined;
      // Overrides are typed as providing nothing so tests can pass a partial layer.
      // The Context check above is what makes that partial context the command graph.
      const application = (
        injected
          ? Context.merge(overrides, baseServices)
          : Context.merge(
              yield* Layer.build(
                composeCli({
                  saveRoot,
                  extensionRoots,
                  overrides: Layer.succeedContext(overrides),
                  catalogOnly: command.kind.startsWith("extension")
                })
              ),
              baseServices
            )
      ) as Context.Context<CliServices>;
      yield* executeCli(command).pipe(Effect.provideContext(application));
      return 0;
    })
  ).pipe(
    Effect.provideService(Logger.LogToStderr, true),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(env)),
    Effect.catchCause((cause) => {
      if (Cause.hasInterrupts(cause)) return Effect.failCause(cause);
      return Effect.sync(() => {
        const error = Cause.squash(cause);
        if (error instanceof Cancelled) {
          stderr("Cancelled.\n");
          return 130;
        }
        stderr(`${Cause.prettyErrors(cause).map(errorMessage).join("\n")}\n`);
        return 1;
      });
    })
  );
}

if (import.meta.main) {
  NodeRuntime.runMain(runCli(process.argv.slice(2)), {
    teardown: (exit, onExit) =>
      exit._tag === "Success" && typeof exit.value === "number"
        ? onExit(exit.value)
        : Runtime.defaultTeardown(exit, onExit)
  });
}
