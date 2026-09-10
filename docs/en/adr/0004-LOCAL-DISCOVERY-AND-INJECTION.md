# ADR 0004: Local discovery, reviewed admission and explicit injection

> Successor: [ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) replaces the dependency injection, asynchronous Port, observation, composition and lifetime details with Effect 4.0.6. This record preserves the decision at its original date; its remaining domain and ownership constraints still apply.

Status: accepted, 2026-10-17.

## Context

The local experiment needs Steam and standalone directory discovery followed by review and admission into an existing Workspace. A directory is evidence rather than proof of a game. Preview JSON can be modified, and Game plus Installation creation crosses files. The implementation also needs deterministic tests without real game I/O.

## Decision

Add core `@konogame/game` at the shared core version `0.1.0-alpha.0`. `game.discover` resolves `game.discovery/discover`, requiring `discovery.local`, `discovery.scoped` and the configured source capability. Filesystem supplies `filesystem.game-discovery`; independently versioned `konogame.steam@0.1.0-alpha.0` supplies `steam.game-discovery`. Steam software compatibility is `generic`, verified with synthetic fixtures rather than a guarantee covering all Steam versions.

Require an existing Host and `configured` source of kind `steam` or `standalone`. The caller explicitly selects scope; Host roots, source declarations and Steam library references never expand it. No network enrichment, executable probing, launch, source creation or game-file mutation is included. Directory candidates have weak identity. New installations have empty `launchEntries`.

Application preview reads configuration and discovery Ports, returning candidates, evidence, diagnostics, dispositions, revisions and bindings. Confirmation strictly parses the preview, anchors root independently, checks its digest, re-reads revision and re-discovers the selected scope with the original bindings, and compares the rebuilt plan. It reconstructs validated records rather than trusting submitted records. The digest detects changes, not authenticated signatures; no TTL is used. Reliable Steam App ID can reuse Game identity, while title similarity cannot. An equal Location on the same Host under another source is a conflict. A fresh duplicate preview can return unchanged; replaying a successfully consumed old preview is stale.

Add `workspace.configuration/import` with `configuration.import`, and `recover-import` with `configuration.import-recovery`. The core configuration implementation shares the rename writer lock, checks hashes, preserves existing record bytes/layout and uses a journal to recover pending creation forward. New files are staged and fsynced in their destination directory, then published by exclusive hard link without target replacement. The Workspace filesystem must support hard links; unsupported publication fails without an overwrite fallback. Joint creation is not atomic across files. External changes stop recovery visibly; recovery operates only on the existing operation journal/receipt. It does not create a general transaction engine, roll back admission, or automatically retry stale previews.

Service composition uses exactly `injection-js` 2.6.1, explicit InjectionToken provider objects and `inject`/`injector.get`, without dependency-injection decorators, `reflect-metadata`, implicit class providers or emitted reflection metadata. DI assembles implementations; Binding Plans independently establish compatible domain capabilities. Classes encapsulate stateful services/complex Adapters; small pure helpers and composition factories remain useful. I/O, clock, IDs, configuration Ports and discovery Adapters are replaceable from the first slice. Entity identity and value semantics guide future domain behavior with stable IDs for entities and value comparison for value objects.

## Consequences and limits

Basic local discovery/import works without a daemon or history. Users review selected candidates and explicitly confirm writes. A standalone directory is never automatically certified as a game by the scanner or by the confirmation action. General edits, streamed progress, durable scan jobs, broader stores, save locators, metadata/AI enrichment and launch remain future work. See the [experiment](../002-WORKSPACE-EXPERIMENT.md), [development guide](../004-DEVELOPMENT.md) and [discovery roadmap](../roadmap/003-GAME-DISCOVERY.md).

## References

- [Valve KeyValues implementation](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/master/src/tier1/KeyValues.cpp), reviewed 2026-10-17. The Adapter implements a bounded data-only subset; local manifest fields are experimental observations, not a stable Valve API guarantee.
- [Official injection-js repository](https://github.com/mgechev/injection-js), reviewed 2026-10-17. Repository policy selects explicit providers and version 2.6.1.

Location and ownership refinement: [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) makes candidate/installation comparison use bound Location validation and comparison, requiring support for both operands. Unknown/incomparable outcomes stay explicit; fresh admission cannot treat them as different. Core `@konogame/workspace-configuration` owns import/journal recovery, with a Module-owned Adapter. Pending recovery restores approved metadata without Location execution or a Location-registration gate.

[English](0004-LOCAL-DISCOVERY-AND-INJECTION.md) | [中文](../../zh/adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md)
