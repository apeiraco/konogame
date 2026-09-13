import { AdapterOwnerKind } from "@konogame/infrastructure/contracts";
import { Context, Effect, Layer } from "effect";
import { ExtensionNotFoundError } from "../adapter-resolution/errors.ts";
import { ADAPTER_REGISTRY, type AdapterRegistry } from "../registry/adapter-registry.ts";
import { EXTENSION_REGISTRY, type ExtensionRegistry } from "../registry/extension-registry.ts";
import { EXTENSION_LIFECYCLE, type ExtensionLifecycle } from "./lifecycle.ts";

export class ExtensionCatalogService {
  constructor(
    private readonly lifecycle: ExtensionLifecycle,
    private readonly extensions: ExtensionRegistry,
    private readonly adapters: AdapterRegistry
  ) {}

  list() {
    return Effect.gen({ self: this }, function* () {
      yield* this.lifecycle.prepared;
      return this.extensions.snapshot.filter(
        (entry) => entry.owner.kind === AdapterOwnerKind.Extension
      );
    });
  }

  status(id?: string) {
    return Effect.gen({ self: this }, function* () {
      yield* this.lifecycle.prepared;
      const extensions = this.extensions.snapshot.filter(
        (entry) => entry.owner.kind === AdapterOwnerKind.Extension
      );
      if (
        id !== undefined &&
        !extensions.some((entry) => entry.id === id || entry.owner.id === id)
      ) {
        return yield* Effect.fail(
          new ExtensionNotFoundError({
            issue: { kind: "extension", id },
            message: `Unknown Extension: ${id}`,
            operation: "status"
          })
        );
      }
      const selected =
        id === undefined
          ? extensions
          : extensions.filter((entry) => entry.id === id || entry.owner.id === id);
      const ids = new Set(selected.map((entry) => entry.id));
      return {
        catalogVersion: this.extensions.catalogVersion,
        sources: this.lifecycle.catalog,
        extensions: selected,
        adapters: this.adapters.snapshot.filter((entry) => ids.has(entry.contributionId)),
        diagnostics: this.lifecycle.diagnostics.filter(
          (entry) =>
            id === undefined ||
            (entry.contributionId !== undefined && ids.has(entry.contributionId))
        )
      };
    });
  }

  refresh(sourceId?: string) {
    return this.lifecycle.refresh(sourceId);
  }
}

export class EXTENSION_CATALOG extends Context.Service<
  EXTENSION_CATALOG,
  ExtensionCatalogService
>()("infrastructure.extension-catalog") {}

export function provideExtensionCatalog() {
  return Layer.effect(
    EXTENSION_CATALOG,
    Effect.gen(function* () {
      return new ExtensionCatalogService(
        yield* EXTENSION_LIFECYCLE,
        yield* EXTENSION_REGISTRY,
        yield* ADAPTER_REGISTRY
      );
    })
  );
}
