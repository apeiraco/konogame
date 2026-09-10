import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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
import {
  EXTENSION_LIFECYCLE,
  type ExtensionDiscoverySource,
  FEATURE_PLAN,
  type FeaturePlanService,
  provideFeaturePlan,
  provideInfrastructure
} from "@konogame/infrastructure";
import { saveModuleSource } from "@konogame/save";
import { workspaceModuleSource } from "@konogame/workspace";
import { tomlWorkspaceConfigurationSource } from "@konogame/workspace-configuration/providers";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { runSync } from "@optique/run";
import {
  Cause,
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
  const dependencies = Layer.merge(installedExtensionFileSystemLayer, overrides);
  return Layer.unwrap(
    Effect.gen(function* () {
      const installed = options.extensionRoots?.length
        ? [yield* nodeInstalledExtensionsSource({ roots: options.extensionRoots })]
        : [];
      const infrastructure = provideInfrastructure({}, [
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
      return provideFeaturePlan().pipe(
        Layer.provideMerge(infrastructure),
        Layer.tap((services) => Context.get(services, EXTENSION_LIFECYCLE).initialize())
      );
    })
  ).pipe(Layer.provideMerge(dependencies));
}

function handleRequest(
  plan: FeaturePlanService,
  request: IncomingMessage,
  response: ServerResponse
) {
  return Effect.gen(function* () {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/health") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/plan") {
      yield* plan.plan([url.searchParams.get("feature") ?? "save.store"]).pipe(
        Effect.match({
          onSuccess: (plan) => {
            response.end(JSON.stringify(plan));
          },
          onFailure: (error) => {
            response.statusCode = 400;
            response.end(
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
            );
          }
        })
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.sync(() => {
        response.destroy();
      })
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterrupts(cause)
        ? Effect.failCause(cause)
        : Effect.sync(() => {
            if (!response.headersSent) response.statusCode = 500;
            response.end(JSON.stringify({ error: String(Cause.squash(cause)) }));
          })
    )
  );
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
    const injectedPlan = Context.getOrUndefined(overrides, FEATURE_PLAN);
    const services = yield* Layer.build(
      injectedPlan
        ? Layer.succeed(FEATURE_PLAN, injectedPlan)
        : composeDaemon({
            saveRoot: options.saveRoot,
            extensionRoots: options.extensionRoots,
            overrides: Layer.succeedContext(overrides)
          })
    );
    const plan = Context.get(services, FEATURE_PLAN);
    // Node request callbacks enter fibers tracked by this server's scope.
    const runRequest = yield* FiberSet.makeRuntime<never, void, never>();
    return yield* Effect.acquireRelease(
      Effect.sync(() =>
        createServer((request, response) => {
          const fiber = runRequest(Effect.scoped(handleRequest(plan, request, response)));
          const onClose = () => {
            if (!response.writableEnded) fiber.interruptUnsafe();
          };
          response.once("close", onClose);
          fiber.addObserver(() => {
            response.off("close", onClose);
          });
        })
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
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      return yield* Effect.fail(
        new DaemonError({ message: "Daemon port must be an integer from 0 to 65535" })
      );
    const server = yield* createDaemon(options);
    yield* Effect.callback<void, DaemonError>((resume) => {
      const onError = (error: Error) => resume(Effect.fail(DaemonError.from(error)));
      server.once("error", onError);
      server.listen(port, options.host ?? "127.0.0.1", () => {
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
          if (error instanceof DaemonStop) return error.code;
          throw error;
        }
      });
      if (parsed !== "start") return parsed;
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
      if (address && typeof address !== "string")
        console.log(`Konogame prototype daemon listening on ${address.address}:${address.port}`);
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
