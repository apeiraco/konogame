import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { NodeRuntime } from "@effect/platform-node";
import { getRequestListener } from "@hono/node-server";
import { filesystemExtensionSource } from "@konogame/extension-filesystem/providers";
import { steamExtensionSource } from "@konogame/extension-steam/providers";
import { workspaceTomlExtensionSource } from "@konogame/extension-workspace-toml/providers";
import { gameModuleSource } from "@konogame/game";
import { provideGameAdmission } from "@konogame/game/admission";
import {
  EXTENSION_LIFECYCLE,
  type ExtensionDiscoverySource,
  provideAdapterResolutionPlanner,
  provideExtensionCatalog,
  provideInfrastructure
} from "@konogame/infrastructure";
import { CORE_VERSION } from "@konogame/infrastructure/contracts";
import {
  installedExtensionFileSystemLayer,
  nodeInstalledExtensionsSource,
  parseExtensionRoots
} from "@konogame/node-installed-extension-source";
import { saveModuleSource } from "@konogame/save";
import { provideSaveStoreWorkflow } from "@konogame/save/store";
import { workspaceModuleSource } from "@konogame/workspace";
import { provideWorkspaceBrowse } from "@konogame/workspace/browse";
import { provideWorkspaceManagement } from "@konogame/workspace/management";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { runSync } from "@optique/run";
import {
  Config,
  ConfigProvider,
  Context,
  Data,
  Effect,
  FiberSet,
  Layer,
  Logger,
  Option,
  Runtime
} from "effect";
import { createApiApp } from "./api/server.ts";
import { provideDaemonArtifactInput } from "./artifact-input.ts";

const daemonProgram = defineProgram({
  parser: object({}),
  metadata: {
    name: "konogame-daemon",
    brief: message`Local prototype daemon`,
    footer: message`Configure KONOGAME_DAEMON_PORT and KONOGAME_SAVE_ROOT through the environment.`
  }
});

class DaemonStop {
  readonly code: number;
  constructor(code: number) {
    this.code = code;
  }
}

export class DaemonError extends Data.TaggedError("DaemonError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  static from(cause: unknown): DaemonError {
    return new DaemonError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause
    });
  }
}
export interface DaemonOptions<Error = never> {
  readonly overrides?: Layer.Layer<never, Error>;
  readonly saveRoot?: string;
  readonly extensionRoots?: readonly string[];
}

export function composeDaemon<Error = never>(
  options: {
    readonly saveRoot?: string;
    readonly extensionRoots?: readonly string[];
    readonly discoverySources?: readonly ExtensionDiscoverySource[];
    readonly overrides?: Layer.Layer<never, Error>;
  } = {}
) {
  const overrides = options.overrides ?? Layer.empty;
  const dependencies = Layer.mergeAll(
    installedExtensionFileSystemLayer,
    provideDaemonArtifactInput(),
    overrides
  );
  return Layer.unwrap(
    Effect.gen(function* () {
      const installed = options.extensionRoots?.length
        ? [yield* nodeInstalledExtensionsSource({ roots: options.extensionRoots })]
        : [];
      const infrastructure = provideInfrastructure({}, [
        saveModuleSource(),
        gameModuleSource(),
        workspaceModuleSource(),
        workspaceTomlExtensionSource(),
        filesystemExtensionSource({
          saveRoot: options.saveRoot ?? join(homedir(), ".konogame", "saves")
        }),
        steamExtensionSource(),
        ...installed,
        ...(options.discoverySources ?? [])
      ]).pipe(Layer.provideMerge(overrides));
      const plans = Layer.mergeAll(
        provideAdapterResolutionPlanner(),
        provideExtensionCatalog(),
        overrides
      ).pipe(Layer.provideMerge(infrastructure));
      return Layer.mergeAll(
        provideWorkspaceManagement(),
        provideWorkspaceBrowse(),
        provideGameAdmission(),
        provideSaveStoreWorkflow(),
        overrides
      ).pipe(
        Layer.provideMerge(plans),
        Layer.tap((services) => Context.get(services, EXTENSION_LIFECYCLE).initialize())
      );
    })
  ).pipe(Layer.provideMerge(dependencies));
}

function closeServer(server: Server) {
  return Effect.callback<void>((resume) => {
    if (!server.listening) {
      resume(Effect.void);
      return;
    }
    server.close((error) => resume(error ? Effect.die(DaemonError.from(error)) : Effect.void));
    server.closeAllConnections();
  });
}

export function createDaemon<Error = never>(options: DaemonOptions<Error> = {}) {
  return Effect.gen(function* () {
    const overrides = yield* Layer.build(options.overrides ?? Layer.empty);
    const services = yield* Layer.build(
      composeDaemon({
        saveRoot: options.saveRoot,
        extensionRoots: options.extensionRoots,
        overrides: Layer.succeedContext(overrides)
      })
    );
    // Framework callbacks enter fibers tracked by this server's Scope.
    const runRequest = yield* FiberSet.makeRuntime<never, Response, unknown>();
    const app = createApiApp(services, runRequest);
    return yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServer(getRequestListener(app.fetch, { overrideGlobalObjects: false }))
      ),
      closeServer
    );
  });
}

export function startDaemon<Error = never>(
  options: DaemonOptions<Error> & { port?: number; host?: string } = {}
) {
  return Effect.gen(function* () {
    const port = options.port ?? 38417;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      return yield* Effect.fail(
        new DaemonError({ message: "Daemon port must be an integer from 0 to 65535" })
      );
    }
    const host = options.host ?? "127.0.0.1";
    if (!["127.0.0.1", "::1", "localhost"].includes(host)) {
      return yield* Effect.fail(
        new DaemonError({ message: "Daemon host must be a loopback address" })
      );
    }
    const server = yield* createDaemon(options);
    yield* Effect.callback<void, DaemonError>((resume) => {
      const onError = (error: Error) => resume(Effect.fail(DaemonError.from(error)));
      server.once("error", onError);
      server.listen(port, host, () => {
        server.off("error", onError);
        resume(Effect.void);
      });
      return Effect.sync(() => {
        server.off("error", onError);
      });
    });
    return server;
  });
}

export function runDaemon(env: NodeJS.ProcessEnv = process.env, argv: string[] = []) {
  return Effect.scoped(
    Effect.gen(function* () {
      const parsed = yield* Effect.sync(() => {
        try {
          runSync(daemonProgram, {
            args: argv,
            programName: "konogame-daemon",
            help: { option: { names: ["-h", "--help"] } },
            version: { value: CORE_VERSION, option: { names: ["-v", "--version"] } },
            completion: "both",
            onExit: (code): never => {
              throw new DaemonStop(code);
            }
          });
          return "start" as const;
        } catch (error) {
          if (error instanceof DaemonStop) {
            return error.code;
          }
          throw error;
        }
      });
      if (parsed !== "start") {
        return parsed;
      }
      const roots = Option.getOrUndefined(
        yield* Config.option(Config.String("KONOGAME_EXTENSION_ROOTS"))
      );
      const server = yield* startDaemon({
        saveRoot: Option.getOrUndefined(yield* Config.option(Config.String("KONOGAME_SAVE_ROOT"))),
        extensionRoots: yield* Effect.try({
          try: () => parseExtensionRoots(roots),
          catch: DaemonError.from
        }),
        port: yield* Config.Number("KONOGAME_DAEMON_PORT").pipe(Config.withDefault(38417))
      });
      const address = server.address();
      if (address && typeof address !== "string") {
        console.log(`Konogame prototype daemon listening on ${address.address}:${address.port}`);
      }
      yield* Effect.never;
    })
  ).pipe(
    Effect.provideService(Logger.LogToStderr, true),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord(env))
  );
}

if (import.meta.main) {
  NodeRuntime.runMain(runDaemon(process.env, process.argv.slice(2)), {
    teardown: (exit, onExit) =>
      exit._tag === "Success" && typeof exit.value === "number"
        ? onExit(exit.value)
        : Runtime.defaultTeardown(exit, onExit)
  });
}
