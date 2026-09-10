# ADR 0009: Application composition package and entry points

> Successor: workflows now live in the module that owns the capability. CLI and daemon each merge those Layers. Add `packages/layer-composition` only when several cross-feature combinations cannot live in an existing module. [ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) remains the Effect contract. This record preserves the composition-package decision at its original date.

Status: accepted, 2026-10-19. Updates the application assembly package/path and API naming in [ADR 0002](0002-WORKSPACE-TOML-AND-TOOLING.md), [ADR 0006](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) and [ADR 0007](0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md). Their lifecycle, service ownership and installed discovery decisions continue to apply.

## Context

The shared package under `apps/shared` assembles dependencies used by several applications. That directory treats reusable assembly as an app, and its package name describes a broad execution concept rather than its responsibility. Its core-only and local entry names also obscure which entry selects local Extensions. Application business orchestration already belongs to `packages/application`.

## Decision

Move shared dependency assembly to `packages/application-composition`, published as `@konogame/application-composition`. This follows the existing package-name/directory convention and identifies the composition root's responsibility: assembling owner-package providers, discovery sources and options. It does not add a business layer, Module, Port, Provider registry or service ownership system.

The root entry `src/index.ts` exports `composeApplication`, `ApplicationCompositionOptions` and `ApplicationContext`. It assembles core Modules and application services without selecting Extensions or importing their implementations. Callers may supply providers and discovery sources explicitly. The `./local` entry `src/local.ts` exports `composeLocalApplication` and `LocalApplicationCompositionOptions`, selecting bundled filesystem/Steam sources and opting into installed discovery only when explicit `extensionRoots` are supplied. Local options extend the root options with `saveRoot` and `extensionRoots`; composition supplies the filesystem save root.

Both functions asynchronously return `ApplicationContext`, the handle for this assembled application: `{ injector, app, ready, dispose }`. Default completion includes initialization/startup; `catalogOnly` completes catalog preparation only, including the returned `ready`. Importing either ESM entry has no startup side effects; composition happens only when called. CLI and daemon remain process boundaries under `apps/`, select the local entry and own startup/disposal.

`apps/cli/src/context.ts` defines `CliContext` for one CLI invocation, with `cliContextStorage` carrying it and `getCliContext()` accessing it; this invocation context holds interaction/output dependencies and lazy application access.

Dependency direction is apps -> application composition -> owner packages. `packages/application` continues to coordinate business workflows through Ports and bindings and must not import application composition. Core continues to own registries, activation, lifecycle and execution policy. Terms such as `ExtensionLifecycle` and `LifetimePolicy` name generation lifetime and cleanup budgets. This decision changes application assembly terminology.

## Consequences

The package location and entry points now expose dependency assembly and local selection directly. Tests and other callers can choose the root entry without selecting bundled Extensions; CLI/daemon opt into local composition explicitly. Existing lifecycle and catalog behavior is preserved. During the experimental phase, remove the old package, `/core` entry and the core/local composition aliases without compatibility shims. Schema and release versions do not change.

[English](0009-APPLICATION-COMPOSITION.md) | [中文](../../zh/adr/0009-APPLICATION-COMPOSITION.md)
