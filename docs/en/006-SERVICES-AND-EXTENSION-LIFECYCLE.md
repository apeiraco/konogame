# 06 Services and Extension lifecycle

Status: current Effect composition and lifecycle, 2026-10-26. [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) supersedes the DI and lifetime details of ADRs 0004, 0006, 0007 and 0009. The [Location guide](005-LOCATION-AND-REGISTRIES.md) defines resource semantics.

## Service ownership and composition

| Owner | Responsibility |
| --- | --- |
| `@konogame/infrastructure` | Owner Context.Service tags and Layers for registries, activation, lifecycle, binding, Temporal/ID services, lifetime policy and generic `LOCATION_BEHAVIOR`; no business Module/Extension imports. |
| Domain packages | Effect Ports, owner errors, Module declarations and I/O service tags. Pure rules/schemas remain pure. |
| `@konogame/workspace-configuration` | TOML/layout algorithms, scoped Node I/O, writer coordination and targeted recovery. |
| `@konogame/workspace`, `@konogame/game`, `@konogame/save` | Workflows for the capability each module owns. Game admission may depend on Workspace. |
| Extensions | Pure manifests/providers, lazy Effect loaders, implementation Layers and vendor/location I/O. |
| Apps | Each entry merges owner Layers, selects filesystem/Steam and explicit installed roots, and owns process/framework bridges. |

`provideInfrastructure` stays limited to registries, activation, lifecycle, binding, Location, ID and time. Binding plans and the extension catalog are separate infrastructure Layers. CLI and daemon merge the workflow Layers they call. `extension` commands only prepare; other CLI commands initialize. Entries supply the filesystem save root; Extensions do not infer home. Importing an entry module does not start the process.

Core root assembly remains one native `Layer.effectContext`. Its accessor has type `Effect<Context<InfrastructureServices>, InfrastructureError>` and polls a Deferred: access during construction fails immediately with the Providers-phase error instead of waiting or exposing a partially assigned context. The Deferred is completed only after the full service graph and lifetime finalizer are installed; later reads share that fixed context and root overrides. Requirements are erased only at the validated dynamic Extension execution boundary. See [core assembly](../../packages/infrastructure/src/providers.ts) and [root-access tests](../../packages/infrastructure/src/__tests__/providers.test.ts).

```ts
import { FEATURE_PLAN, provideFeaturePlan, provideIdService, provideInfrastructure } from "@konogame/infrastructure";
import { saveModuleSource } from "@konogame/save";
import { Effect, Layer } from "effect";

const infrastructure = provideInfrastructure({}, [saveModuleSource()]).pipe(
  Layer.provideMerge(provideIdService({
    uuidV7: () => Effect.succeed("01900000-0000-7000-8000-000000000001")
  }))
);

export const program = Effect.gen(function* () {
  return yield* (yield* FEATURE_PLAN).features();
}).pipe(Effect.provide(provideFeaturePlan().pipe(Layer.provideMerge(infrastructure))));

// Importing this module must not start the application.
if (import.meta.main) {
  await Effect.runPromise(program);
}
```

See [infrastructure Layers](../../packages/infrastructure/src/providers.ts), [binding plans](../../packages/infrastructure/src/binding-plan.ts), [Workspace management](../../packages/workspace/src/management.ts), [admission](../../packages/game/src/admission.ts) and [save writes](../../packages/save/src/store.ts). Workflows do not import an entry. The CLI entry is [apps/cli/src/main.ts](../../apps/cli/src/main.ts) and the daemon entry is [apps/daemon/src/main.ts](../../apps/daemon/src/main.ts). CLI `context.ts` owns interaction/output. Optique parses arguments inside the owned Effect; official Effect Runtime APIs retain upstream names. Daemon construction, listening and requests have native scopes. Process exit stays at `import.meta.main`. CLI JSON/non-TTY execution never prompts; cancellation writes no approved business change unless publication has already passed its noncancellable boundary.

Known schema and rule refusals use structured owner tags/issues; infrastructureRule, workspaceRule, admissionRule and configurationRule preserve recognized objects as Fail, while unexpected trusted-code throws remain Die. UnexpectedBoundaryError is reserved for explicitly identified third-party boundaries and does not make arbitrary Extension/schema behavior exhaustive. WorkspaceConfigurationError includes known schema/rule errors, filesystem/configuration-input/writer conflict and recovery data protocols, explicit boundary errors and fresh-admission LocationError; implementation classes and native code/cause remain with their owners. Cause-aware result handling never converts Die/Interrupt to an ordinary workflow status. See the [development error guide](004-DEVELOPMENT.md#typed-rule-failures-and-defects).

## Scope owns resources

Use `Effect.acquireRelease`, `Effect.acquireUseRelease`, scoped Layers and native finalizers for handles, streams and external resources. One scope owns each resource and releases it in reverse acquisition order. Business code does not manually destroy services or add duplicate-destruction guards. Existing external-library disposal semantics remain intact. In-memory objects need no destructor; use WeakMap/WeakRef for caches that must not retain objects.

Artifact files are a Stream, with each byte Stream opened on demand and its handle owned by Scope. Consumers do not buffer a whole asset or assume a single file. Native Fiber/Deferred/Clock provide concurrency, completion and time; TestClock controls tests. Business Ports do not propagate AbortSignal. Real external asynchronous bridges may use the signal supplied by Effect.

## Declare first, activate on demand

`ExtensionDiscoverySource` has a stable id and `discover(): Effect<DiscoveryBatch, unknown>`. Batches carry complete/contributions/diagnostics/restartRequired semantics. Contributions carry kind/manifest/lazy `load()` and optional id/revision/reloadPolicy. Loaders return an Effect of ExtensionModule; Promise-based compatibility loaders are absent. Pure `/providers` entries do not statically import implementations.

Strict validation precedes relationships and loaders, including malformed/sparse source items and unknown fields. An internal commit updates both registry indexes and snapshots before public notification with one catalogVersion. Private PubSub channels expose read-only `state$`, `results$`, `diagnostics$` Streams and snapshots. Public results do not synchronize registries. Stream consumers run as scope-owned fibers.

`prepare()`/`prepared` discovers and registers the catalog only. `initialize()`/`ready` adds explicit startup activation. Binding waits for preparation, negotiates Contract/Operation/Capability/Location compatibility, then lazily activates the selected contribution and dependencies before implementation access. Explicit events are respected; inferred demand selects one compatible contribution. Bundled filesystem/Steam have no onStartup event. Late declarations replay remembered events and the default last 256 distinct complete binding requests; request equality is not resource identity.

`ExtensionModule.layer` is an optional Layer or activation-context function returning a Layer. `activate(context)` returns an Effect. Core builds one native Layer/Scope generation; explicit root overrides win and the root remains fixed. `context.dependencyServices(id)` returns only declared active dependency contexts. Steam consumes filesystem services this way. `context.registerAdapter` stages implementations until activation succeeds. Concurrent activation shares native completion per generation; failures are cached per generation, while missing/version/cycle dependency diagnostics remain re-evaluable. There is no second service registry.

Filesystem's lazy loader calls `createFilesystemExtensionModule` with composition-supplied saveRoot. See [filesystem source](../../extensions/filesystem/src/providers.ts), [filesystem module](../../extensions/filesystem/src/index.ts), [Steam module](../../extensions/steam/src/index.ts) and [activation](../../packages/infrastructure/src/activation.ts).

## Catalog management and installed code

Without a Contribution revision, unchanged scans must preserve load function identity. Built-in source factories create their batch, contributions and loaders once, and discover returns those stable declarations. Sources with revisions must update them when content or loading semantics change; do not force replacement with a fresh closure on every scan or hide real changes behind a fixed revision.

`ExtensionLifecycle.register/refresh` and registry replace/remove keep source-owned deltas. Unchanged revisions preserve generations; incomplete/error scans cannot remove unseen old entries. Conflicts never silently override another source. Missing/incompatible/cyclic dependencies preserve valid declarations with diagnostics and block activation without disabling unrelated capabilities.

Remove/replace only inactive contributions without active/activating dependents or attempted-code restrictions. Active changes and attempted restart-after-load code, including failed loader attempts, return `restart-service-required` without mutation. No Extension-only reload or automatic restart exists. Node ESM caches require a real process/service restart; a fresh Layer or cache-busting URL cannot release code.

`KONOGAME_EXTENSION_ROOTS` is a JSON array of unique absolute roots. The Node scanner reads one package level and data-only `extension.package.1` manifests, checks canonical/realpath anchors, 1 MiB manifests/256 candidates, hashes manifest and streamed entry, and rechecks before lazy import. Revisions detect changes; they do not authenticate code or hash its entire dependency tree. No home/node_modules default scan, marketplace, watcher or independent host isolation exists. CLI extension list/status/refresh prepares only; its short-lived refresh persists no management state. See the [comparison and package guide](007-EXTENSION-SYSTEM-COMPARISON.md).

## Filesystem save publication

The internal [publication helper](../../extensions/filesystem/src/publication.ts) retries only a native rename EPERM on Windows. It publishes the already-written staging directory without replaying Artifact input, copying again or generating another ID. There are at most five total attempts, with cancellable 25/50/100/200ms backoffs (375ms total). An Effect Clock-based 500ms soft budget starts at helper entry and constrains only later retries; the first attempt is always allowed, even after a slow initial lstat. Retry checks run when allowing retries and again before a later rename, after its target check. Each native rename has a narrow interruption mask and is awaited until it settles; an in-flight call may exceed the soft budget.

Each attempt uses lstat to reject any existing target immediately; target-check failures other than ENOENT are not retried. Exhaustion preserves the SaveError/native cause, and failure cleanup removes only the owned staging directory, never the target. The target precheck has a TOCTOU window: it is not a portable atomic no-replace operation or a general transaction. The observed native EPERM root cause remains unknown; this bounded policy does not establish one.


## Cooperative deadlines and recovery

`coreOptions.budgets` defaults to discovery/load 15s each, activation 30s, total shutdown 5s and cleanup 1s each; demandCacheLimit defaults to 256. Native Clock/Fiber/Scope implement waits and cleanup. Phase diagnostics describe source/contribution/generation, cause and elapsed time where available. Failure does not prevent subsequent reverse cleanup, and incomplete cleanup is reported. Late publication is sealed.

For cooperative custom Extension cleanup, register [addLifetimeFinalizer](../../packages/infrastructure/src/services.ts). It uses native Effect.addFinalizer within the generation Scope and applies LifetimePolicy through an interruptible cleanup with the individual and remaining total budget; it does not create a second executor. Ordinary Effect.acquireRelease/addFinalizer releases and library resource finalizers retain native Scope semantics, which normally protect release from interruption even without an Extension explicitly masking it. The 1s/5s policy is not a universal hard deadline for those finalizers, and interruption does not prove a handle has closed.

These deadlines are cooperative. Synchronous non-yielding code, deliberately uninterruptible effects and external operations that cannot cancel may outlast a deadline. No in-process scheduler can force-stop or sandbox them. There is no detached cleanup scheduler. Small native filesystem publication steps may mask interruption until that one operation completes.

Workspace writes scope writer acquisition/release and release only owned locks. Interruption remains Interrupt and retains applicable journal/recovery material. In Effect 4.0.6, a nested acquireUseRelease interrupted by a real Fiber.interrupt can leave only Interrupt in the outer Cause and omit an additional finalizer failure. Recovery-required lock/rename finalizers therefore log structured diagnostics with Effect's Logger before completing; CLI/daemon use stderr logging to preserve JSON stdout. Ordinary failures retain typed errors/results. Do not promise every interruption carries a complete cleanup Cause or that the journal provides general transactions/atomic directory publication.

[English](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) | [中文](../zh/006-SERVICES-AND-EXTENSION-LIFECYCLE.md)
