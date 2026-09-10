# 07 Extension system: source comparison and remaining work

Status: implementation comparison, 2026-10-18. This report compares verified source revisions, identifies concrete gaps in the previous Konogame slice, and records the changes accepted in [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md). It does not claim VS Code/Theia API compatibility.

## Evidence and changes

Reference revisions: VS Code `60541952313cbc2728cab30dacddf4154e5b10c9`; Theia `046af0812516f46f2bf7ce3357cca0b672159b20`. Links below pin those revisions. The comparison used read-only source inspection, without installing or building either reference project.

| Concern and source evidence | Previous Konogame gap | Implemented response |
| --- | --- | --- |
| VS Code validates manifest fields, dependency lists and activation events before use: [extensionValidator](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/extensions/common/extensionValidator.ts#L242). | Relationship checks did not establish that every nested declaration was structurally valid. Malformed source items could escape isolation. | Strict Contribution, Extension/Module/Feature/Adapter, software, dependency, event and Location schema validation before relationships or loaders. Unknown fields are rejected; malformed source results/items, including sparse arrays, receive safe diagnostics. |
| VS Code rebuilds indexes and increments its version before notifying observers: [extensionDescriptionRegistry](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts#L103). | Public registration subscribers could observe Extension and Adapter catalogs at different revisions or re-enter between updates. | An internal Symbol-based commit updates both registries' indexes/snapshots before public notifications. `catalogVersion` ties snapshots/results together; public streams observe committed state and do not drive synchronization. |
| VS Code derives activation from contributions: [implicitActivationEvents](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/extensionManagement/common/implicitActivationEvents.ts#L14); its service replays prior demand on additions: [abstractExtensionService](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L406). | A late Module Feature or Location definition could leave an existing inactive contribution unmatched; partial request keys could overwrite materially different demands. | Catalog changes re-evaluate remembered events and up to 256 distinct complete binding requests by default. Explicit events retain their behavior; contribution-inferred demand activates only selected compatible Adapters. Request-cache equality is not resource identity comparison. |
| VS Code shares activation operations: [extHostExtensionActivator](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/api/common/extHostExtensionActivator.ts#L217). Theia separates actual plugin activation: [plugin-manager](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/plugin/plugin-manager.ts#L314). | Synchronous observer re-entry could occur before a lifecycle completion handle was installed. Catalog preparation also initiated startup. | Native Deferred/Fiber share completion before re-entrant observations. `prepare` only prepares the catalog; `initialize` adds startup activation. Per-generation activation sharing, dependency/wait-cycle diagnostics and staged implementation publication are retained. |
| Theia separates directory enumeration, JSON metadata and module entry reading: [local-directory resolver](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/main/node/resolvers/local-directory-plugin-deployer-resolver.ts#L36), [JSON package reader](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext-vscode/src/node/plugin-vscode-directory-handler.ts#L120), [plugin reader](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/hosted/node/plugin-reader.ts#L140). | Only bundled/injected declarations existed; there was no real installed-package discovery source. | New core-versioned `@konogame/extension-discovery-node` reads strict JSON from explicitly configured roots and defers ESM import/factory invocation until activation. Path anchoring, byte/count limits, revisions and loader rechecks report invalid or changed packages. Core remains independent of filesystem implementation. |
| VS Code provides contribution-point schemas/generators and delta processing: [extensionsRegistry](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/extensionsRegistry.ts#L675). | Source identity, incomplete scans and refresh ownership were not modeled. | Stable source IDs and `DiscoveryBatch` completion/diagnostics support real add/unchanged/replace/remove deltas. Failed/incomplete scans do not erase old entries. CLI exposes catalog list/status/refresh; generic contribution-point extensibility remains future work. |
| Theia bounds graceful host shutdown and can terminate a separate process: [plugin-host](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/hosted/node/plugin-host.ts#L109), [hosted-plugin-process](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/hosted/node/hosted-plugin-process.ts#L123). | A never-settling discover/load/activate/cleanup could prevent shutdown and hide incomplete cleanup. | Cancellation and configurable phase deadlines bound asynchronous waiting, seal activation contexts, prevent late publication, consume late rejections and report structured phase diagnostics. Cleanup continues after individual failures and reports incomplete cleanup, subject to cooperative Scope finalization. Konogame has no separate host or process kill. |
| Theia distinguishes root and child contribution containers: [contribution-provider](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/infrastructure/src/common/contribution-provider.ts#L86). | The previous scope boundary already met the current need. | Use Effect 4.0.6 owner Context.Service tags, a fixed root, native generation Layers/Scopes, root overrides and declared active dependency contexts. Do not import Theia's container framework or add a second service registry. |

In-process Location `dataSchema` may be an explicitly supplied Standard Schema; evaluating/converting it can invoke schema hooks, including its documented getter interface. Strict ordinary-declaration validation is not a no-code-execution or sandbox guarantee. Installed Node package metadata is pure JSON and has no executable schema hooks.

The local implementations are [strict contract schemas](../../packages/contracts/src/manifest.ts), [catalog validation](../../packages/infrastructure/src/manifest-validation.ts), [registries](../../packages/infrastructure/src/registry.ts), [lifecycle/refresh](../../packages/infrastructure/src/lifecycle.ts), [activation](../../packages/infrastructure/src/activation.ts) and [Node discovery](../../packages/extension-discovery-node/src/source.ts). Synthetic tests cover malformed inputs, observer re-entry, late declarations, pending tasks and installed-package changes; full repository verification is tracked with the implementation work, rather than inferred from the reference projects.

## Installed package and catalog usage

Configure `LocalApplicationCompositionOptions.extensionRoots` or `KONOGAME_EXTENSION_ROOTS`, a JSON array of unique absolute paths. No roots means no installed scan; there is no implicit home or node_modules search. Each root's immediate package directories may contain `konogame-extension.json`:

```json
{
  "schemaVersion": "extension.package.1",
  "manifest": {
    "id": "example.demo",
    "version": "0.1.0",
    "contractRange": ">=0.2.0 <0.3.0",
    "software": { "node": ">=26" },
    "activationEvents": ["onStartup"],
    "contributes": {}
  },
  "module": {
    "entry": "./dist/extension.mjs",
    "factory": "createExtensionModule",
    "options": { "label": "Synthetic example" }
  }
}
```

The named factory receives `options` and returns an `ExtensionModule`. Options use the public serializable value subset. The entry is a `./` relative path without traversal, backslashes or URL components; canonical paths/realpaths must remain anchored. Manifests are limited to 1 MiB and scans to 256 package-directory candidates, with stable ordering and per-package diagnostics. Discovery hashes manifest bytes and streams the entry for SHA256; the revision also includes anchored paths. The loader rechecks observations before import. These checks detect changes; they are not signatures, a complete dependency-tree digest or an atomic filesystem/import transaction.

```sh
just cli extension list --json
just cli extension status example.demo --json
just cli extension refresh --json
```

These commands use `catalogOnly: true`, without firing startup or executing package code, including explicitly declared `onStartup`. Normal business process initialization still respects startup events. CLI is short-lived: refresh rescans only that invocation's process and does not persist management decisions. Long-lived callers use the Effect-returning extension management service or `ExtensionLifecycle.refresh(sourceId?)` for actual catalog deltas; `list` and `status(id?)` expose catalog, activation, and diagnostic state.

Unchanged manifest/revision does not create a generation. Incomplete scans, diagnostics or restart-required observations do not authorize removal of unseen old entries. Source conflicts do not silently override another source. Active/activating changes and installed code already attempted under `restart-after-load` require restart. Node ESM caching is process-wide; changed attempted code cannot be made fresh by adding URL query strings or replacing only the contribution. A process/service restart boundary must actually release that code environment.

## Waiting and shutdown guarantees

Native Effect Clock/Fiber/Scope provide cooperative discovery/load (15s each), activation (30s), shutdown (5s total) and cleanup (1s each) budgets. `coreOptions.budgets` and `demandCacheLimit` are ordinary settings; tests replace owner Layers and use TestClock. Business Ports do not accept AbortSignal; real external bridges use Effect cancellation. Late publication is sealed and incomplete cleanup is diagnosed.

These deadlines cannot force-stop synchronous/non-yielding or deliberately uninterruptible work, sandbox imported code or guarantee all resources were released. Nested acquireUseRelease under real Fiber.interrupt in Effect 4.0.6 can omit an additional finalizer failure from the outer Interrupt Cause. Recovery-required finalizers log structured diagnostics before finishing, with CLI/daemon logs on stderr. See the [lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) and [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md).

## Deliberately deferred

| Capability | Trigger for implementing it and reason |
| --- | --- |
| Persistent enable/disable and global/Workspace policy | When users need repeatable selections across sessions; define precedence, storage and changed-running-code policy first. Current catalog mutations are in memory. VS Code's [enablement handling](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L1453) is a reference, not a current Konogame feature. |
| Generic third-party contribution points | When a concrete third contribution category needs registration, validation and activation semantics. Current `adapters`/`locations` are intentionally finite. |
| Marketplace/download/install UI | When there is a real distribution workflow, including trust, version selection and filesystem publication. Catalog refresh is not installation. |
| Filesystem watcher | When long-lived sessions need automatic change discovery; define debounce, partial-write and conflict behavior before replacing explicit refresh. |
| Independent host/RPC/remote execution | When failure containment, preemptive termination or remote placement is required. This needs an explicit process/protocol and resource-ownership contract. |
| Hot unload or Extension-only restart | After a host boundary can release code, dependency scopes and resources reliably. ESM caching and active dependencies currently require restart instead of a false unload guarantee. |

Workspace schema 4, admission/recovery, streaming Artifacts and private game data are unchanged by this work. Roadmap decisions remain in the [initial iterations](roadmap/001-INITIAL-ITERATIONS.md) and [frontend proposal](roadmap/004-FRONTEND-EXPERIENCE.md).

[English](007-EXTENSION-SYSTEM-COMPARISON.md) | [中文](../zh/007-EXTENSION-SYSTEM-COMPARISON.md)
