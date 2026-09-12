import { registerHooks } from "node:module";

export async function inspectComposedInstallation(root: string): Promise<void> {
  if (!root) {
    throw new Error("Missing workspace root");
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@konogame/extension-filesystem")) {
        throw new Error("Filesystem Extension package is absent");
      }
      return nextResolve(specifier, context);
    }
  });

  const {
    provideInfrastructure,
    provideAdapterResolutionPlanner,
    provideExtensionCatalog,
    EXTENSION_LIFECYCLE
  } = await import("@konogame/infrastructure");
  const { saveModuleSource } = await import("@konogame/save");
  const { gameModuleSource } = await import("@konogame/game");
  const { workspaceModuleSource } = await import("@konogame/workspace");
  const { provideWorkspaceManagement, WORKSPACE_MANAGEMENT } = await import(
    "@konogame/workspace/management"
  );
  const { workspaceTomlExtensionSource } = await import(
    "@konogame/extension-workspace-toml/providers"
  );
  const { Effect, Layer, Context } = await import("effect");
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const infrastructure = provideInfrastructure({}, [
          saveModuleSource(),
          gameModuleSource(),
          workspaceModuleSource(),
          workspaceTomlExtensionSource()
        ]);
        const plans = Layer.mergeAll(
          provideAdapterResolutionPlanner(),
          provideExtensionCatalog()
        ).pipe(Layer.provideMerge(infrastructure));
        const services = yield* Layer.build(
          provideWorkspaceManagement().pipe(
            Layer.provideMerge(plans),
            Layer.tap((value) => Context.get(value, EXTENSION_LIFECYCLE).initialize())
          )
        );
        const inspected = yield* Context.get(services, WORKSPACE_MANAGEMENT).inspectWorkspace(root);
        process.stdout.write(JSON.stringify(inspected.installations[0]));
      })
    )
  );
}

if (import.meta.main) {
  await inspectComposedInstallation(process.argv[2] ?? "");
}
