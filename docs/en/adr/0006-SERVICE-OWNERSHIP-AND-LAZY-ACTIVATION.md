# ADR 0006: Service ownership and lazy activation

> Successor: [ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) replaces the dependency injection, asynchronous Port, observation, composition and lifetime details with Effect 4.0.6. This record preserves the decision at its original date; its remaining domain and ownership constraints still apply.

Status: accepted, 2026-10-17. Refines [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)'s registration, dependency and activation behavior; its Location envelope and persistence ownership remain effective.

Later refinement: [ADR 0007](0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) adds strict declaration/source boundaries, internal catalog commit before public observation, catalog-only preparation, Node installed discovery and bounded cancellation/cleanup diagnostics. The earlier source/stream/startup details below are historical; service ownership and generation scopes remain effective.

Subsequent decision: [ADR 0009](0009-APPLICATION-COMPOSITION.md) replaced the historical assembly names, and that composition package was later retired. Workflows live in the owning module; CLI and daemon each compose Layers. The old names below describe the accepted decision at that time; lifecycle and lifetime policy terminology remains valid.

## Context

Composition must discover available capabilities without loading every implementation. Services, Ports and tokens need clear owners so applications only compose and start them. Missing Extensions must not disable unrelated features, and added implementations must work without preinstalled root services.

## Decision

Add `@konogame/infrastructure` as a foundation depending on contracts and infrastructure, with no business Module/Extension dependencies. It owns registries, activation, lifecycle, binding, Temporal/ID services and their tokens/providers. Domain packages own domain Ports/tokens/providers, application owns application services/tokens, configuration implementation owns its I/O, and Game owns discovery I/O. Replaceable concurrent Adapter implementations use distinct implementation tokens. Apps choose sources/providers and process parameters, then start and dispose.

Use one internal multi discovery-source contribution flow. Sources return manifests and lazy loaders; manifests declare `activationEvents` and `contributes.adapters`/`contributes.locations`. Register all discovered declarations before demand. AdapterRegistry subscribes to successful declaration results and registers descriptors independently from activation. Pure manifest/provider entries do not import implementations. Built-in filesystem and Steam have no `onStartup` declaration.

Inspired by VS Code's manifest and activation-event separation, support explicit `onStartup`, `onFeature:<id>`, `onPort:<id>` and `onLocation:<type>` events. This is a Konogame API, without VS Code API compatibility. Explicit matching declarations are respected. Contribution-derived demand activates the selected compatible Adapter's contribution and dependencies, avoiding eager activation of all candidates. Binding becomes asynchronous and preserves Contract/Operation/Capability/Location negotiation and explicit-preference failures.

Core creates a native injection-js child injector per contribution generation after its loader returns. `ExtensionModule.providers` is an explicit provider array or context function. Explicit root overrides win over child defaults; root is not mutated. `context.injector` accesses the contribution scope; `context.dependencyInjector(id)` accesses only declared, active dependency scopes. Steam uses filesystem's scope for shared discovery I/O. Filesystem's loader calls `createFilesystemExtensionModule` with composition-supplied saveRoot; neither root preinstallation nor Extension inference of home is required. There is no loaded-cell layer or second service registry.

All implementation registrations from an activation are staged and published only on success. Dependencies activate first. Concurrent work for one contribution/generation shares a Promise, code failures remain cached within that generation, and activation wait cycles are diagnosed. Missing/incompatible/cyclic dependencies preserve valid catalog entries with diagnostics and blocked activation; repaired catalog conditions can be re-evaluated. Structural, identifier, type and Adapter conflicts reject the registry mutation atomically. Lifecycle isolates Extension/source failures; invalid core Module registration aborts initialization.

Registries and activation expose private RxJS Subjects/BehaviorSubjects through read-only state/result observables and snapshots. Lifecycle exposes read-only state and diagnostics. Promises represent async completion; subscribers explicitly track pending work without `async subscribe`. A preparation barrier resolves after catalog/descriptor registration and before startup activation; binding waits for `prepared` so startup code can request other Features. Entry points await full `ready`, which includes startup handling.

Lifecycle supports implementation registration; ExtensionRegistry supports safe inactive removal/replacement. Active/activating contributions or active/activating dependents require `restart-service-required`, preserving current state. There is no independent Extension host and no Extension-only reload yet. Shutdown signals cancellation, waits for tracked work, performs reverse cleanup and closes subscriptions. A caller may create a new process deliberately; no automatic restart is supplied.

## Entry points and scope

The core and local composition functions return `{ injector, app, ready, dispose }` asynchronously; the former imports no Extensions, while the latter composes bundled pure provider entries. CLI creates that composition on first application demand; help/schema/version do not create it, features discovers declarations and respects explicit startup events, and CLI always releases what it owns. Daemon initializes before listening and disposes on shutdown/listen failure. Old `LOCAL_*` tokens and `create*Application` helpers are removed without compatibility shims.

Current support includes bundled/injected sources, lazy code loading, activation scopes, diagnostics and live catalog management. Marketplace/download, external disk installation scanning, installation UI, independent host isolation and automatic restart are absent. Workspace schema 4, reviewed admission, unknown Location retention and approved journal recovery remain unchanged. Core/Extension release versions remain unchanged.

## References

- [VS Code activation events](https://code.visualstudio.com/api/references/activation-events) and [Extension manifest](https://code.visualstudio.com/api/references/extension-manifest): inspiration for declarations and demand-driven activation, reviewed 2026-10-17.
- [RxJS BehaviorSubject API](https://rxjs.dev/api/index/class/BehaviorSubject): observable state infrastructure, reviewed 2026-10-17.
- [Service/lifecycle guide](../006-SERVICES-AND-EXTENSION-LIFECYCLE.md): owner table, real source links and usage examples.

[English](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) | [中文](../../zh/adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)
