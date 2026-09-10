# Changelog

Core binaries and packages share a version. Extensions have independent versions, recorded in their own sections below. This alpha records the current local prototype; it is not a registry publication announcement.

## Unreleased

### Changed

- Replace oclif with Optique 1.3 command parsers for the CLI, daemon, and dev-cli. Public arguments stay the same, including space-separated commands, `--json`, `--non-interactive`, `--interactive=false`, `-h`, and `-v`. Completion covers Bash, zsh, fish, PowerShell, and Nushell. Injected tests call the exported runner; built entries run as processes.

- Retire the Application aggregate and `packages/application-composition`. Workflows live in the owning module: binding plans and the extension catalog in infrastructure, Workspace inspection and edits in workspace, discovery admission in game, and save writes in save. CLI and daemon each merge those Layers. Add `packages/layer-composition` only when several cross-feature combinations cannot live in an existing module. `packages/core` is now `packages/infrastructure`; the shared release group name `core` is unchanged.

- Declare external dependency versions once in the default pnpm catalog. Manifests use `catalog:` with `catalogMode: strict`. Workspace release versions remain in `konogame-metadata.toml`.

- Classify a test by the workflow it proves. One rule, one service, one Adapter directory fixture, and CLI help/flags/JSON stay unit tests. Integration tests keep complete user workflows and the failures already identified for those workflows.

### Added

- Migrate side-effecting Ports, Adapters, application and entries to exact Effect 4.0.6 owner Context.Service/Layer, Scope/Fiber/Deferred/Clock, PubSub/Stream observations and on-demand multi-file Artifacts, replacing prior DI/Promise assembly and manual lifetime management. Composition returns complete native Layers; tests replace owner Layers and use TestClock. Add bilingual ADR 0011. Bump Contract protocol to `0.2.0` with `>=0.2.0 <0.3.0`; Schema 4, extension.package.1 and core/Extension releases `0.1.0-alpha.0` remain unchanged. Preserve journal/lock and approved metadata recovery, with cooperative cleanup budgets and structured stderr diagnostics on interruption. Refine known rule errors into owner tags/structured issues, preserve trusted-code defects and interruption Causes, and report early root-service access as a typed assembly failure.

- An earlier slice renamed the per-invocation CLI context module/APIs to `context.ts`, `CliContext`, `cliContextStorage` and `getCliContext()` while preserving command behavior. [ADR 0011](docs/en/adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) subsequently replaced the storage/getter mechanism with owner Context.Service and scoped `CLI_COMMAND_BRIDGE`, retaining the `context.ts` and `CliContext` names.

- Define test boundaries by purpose, separate injected/process integration checks from built executable Workspace workflows, and add differentiated Vitest budgets, DI-based experimental virtual filesystem tests, CLI process/terminal coverage and Turborepo build prerequisites. Document the decisions in bilingual ADR 0010; Schema and release versions are unchanged.

- Move dependency assembly from `apps/shared` to `packages/application-composition` (`@konogame/application-composition`). The root `composeApplication` is Extension-neutral; `./local` exports `composeLocalApplication` with bundled filesystem/Steam and opt-in installed roots. Rename options/context to application composition terms without compatibility aliases; business workflows remain in `packages/application`. Add bilingual ADR 0009; schema and release versions remain unchanged.
- Add existing-root Workspace/initial Host initialization with disabled history, exclusive configuration reservation and targeted recovery, plus reviewed Host/source/root and single-record metadata/settings maintenance.
- Add strict read-only edit previews and fresh-review apply, shared writer coordination, comment/newline-preserving TOML edits and targeted edit recovery. Preserve UUID/uniformName/Location and referenced source invariants; unchanged record bytes do not imply zero coordination writes.
- Add game library list/show and seven-layer settings explanation with provenance, explicit clears and Feature availability. Add bilingual management guide and ADR 0008; no Git/daemon dependency, arbitrary editor, launch or schema/version change.
- Add strict declaration/source validation, consistent internal Extension/Adapter catalog commits with catalogVersion, late-event/request re-evaluation and catalog-only preparation separate from startup.
- Add core-versioned Node installed-package JSON discovery from explicit roots, checked lazy entry/factory loading, revision-aware refresh deltas and catalog-only extension list/status/refresh CLI. Incomplete scans preserve old entries; attempted ESM code changes require restart. CLI refresh is not persistent installation management.
- Add cancellation and configurable discovery/load/activation/shutdown/cleanup deadlines with structured phase diagnostics, late-publication prevention and explicit incomplete-cleanup failures. These bounds do not isolate or force-terminate in-process code. Add bilingual VS Code/Theia comparison and ADR 0007; schema 4 and release versions remain unchanged.
- Add core service ownership, manifest discovery and lazy Extension activation with read-only RxJS catalog and activation state, preparation/startup barriers, native injection-js child scopes and explicit active dependency access. Adapter implementations publish only after successful activation; dependency problems retain catalog diagnostics without disabling unrelated features. (Earlier slice record; current service/asynchronous/lifetime APIs are superseded by the Effect model in ADR 0011.)
- Add bundled/injected contribution sources and implementation registration/removal/replacement APIs. Active changes report `restart-service-required`; marketplace/download, Extension-only reload and automatic restart remain unimplemented.
- Replace app-local token/service wiring with owner-package providers and async `composeApplication`/`composeLocalApplication`, async planning and deterministic disposal. CLI help/schema/version avoid service creation; daemon initializes before listening. Add bilingual lifecycle guide and ADR 0006; schema 4 and release versions remain unchanged. (Earlier slice record; current service/asynchronous/lifetime APIs are superseded by the Effect model in ADR 0011.)
- Add serializable Location envelopes in breaking Workspace schema 4, validated Extension/type and Adapter/implementation registries, per-operation Location bindings and typed non-path resources. Unknown types/schemas remain readable and preserved as unverified/unavailable; no schema 3 migration or private configuration rewrite is provided.
- Move TOML, metadata layouts and read/rename/import/recovery into core `@konogame/workspace-configuration`, using Module-owned `core.workspace-configuration`; filesystem owns Location types/behavior and native discovery I/O. Adapter descriptors/bindings now declare module/extension owner. Core and Extension releases remain `0.1.0-alpha.0`; filesystem Location schema is independently `1.0.0`.
- Require valid/comparable Locations for fresh admission while preserving approved import-journal recovery without Location execution/registration. Add bilingual ADR 0005 and practical Location/registry guidance.
- Add core `@konogame/game`, bounded local Steam/standalone candidate previews, explicit reviewed admission into an existing configured Host/source, and strict revision/evidence/binding revalidation.
- Add explicit injection-js 2.6.1 token composition, replaceable I/O/clock/IDs/Adapters, synthetic workflow tests, and bilingual development guidance/ADR 0004. (Earlier slice record; current service/asynchronous/lifetime APIs are superseded by the Effect model in ADR 0011.)
- Extend local discovery and core Workspace configuration with additive Game/Installation import, shared writer locking, hash/journal checks and explicit forward recovery after partial creation; existing record bytes/comments are preserved. Cross-file creation is not atomic.

## 0.1.0-alpha.0

### Added

- Add Biome recommended checks, inline type imports/exports, enum restrictions, and shared formatting commands.
- Separate Vitest unit, integration, and end-to-end suites, with dedicated package test projects and explicit TypeScript references.
- TypeScript Modules, Features, Ports/Contracts, Operations, Capabilities, Extensions, Adapters, and Binding Plans shared by CLI and daemon application services.
- Streamed multi-file Artifacts and default filesystem save storage without mandatory history or daemon.
- TOML 1.0 Workspace schema 3 with separate Game, Host, and Installation identities, UUIDv7, seven configuration layers, explicit clears, typed paths, and arbitrary Host roots.
- Unicode `uniformName` projections, equivalent file/directory layouts, and comment-preserving rename with conflict checks and interrupted-operation recovery.
- oclif and Clack command-line workflows, safe ESM entry points, tsdown builds, Vitest checks, and hierarchical TypeScript projects with source-aware editor resolution.
- Bilingual architecture, ADRs, roadmap, and historical archive.
- Canonical project metadata, synchronized core versions, independent Extension versions, Contract compatibility ranges, software compatibility declarations, and local release maintenance commands.

### Compatibility

- Core release: `0.1.0-alpha.0`; Contract protocol: `0.1.0`; supported Contract range: `>=0.1.0 <0.2.0`.
- Experimental schemas and APIs may break without historical migration or compatibility readers.
- `latest` means unpinned or insufficiently tested software compatibility; `generic` means a protocol/format adapter without a software release constraint. Future Extensions described in the roadmap remain unimplemented.

## konogame.filesystem@0.1.0-alpha.0

### Added

- `filesystem.save-store` for streamed multi-file saves.
- `filesystem.workspace-configuration` for strict TOML inspection and entity rename/recovery.

### Compatibility

- Contract range: `>=0.1.0 <0.2.0`; Node.js `>=26`.
- This Extension's version advances independently of the core release.

## konogame.steam@0.1.0-alpha.0

### Added

- Add `steam.game-discovery` for selected local Steam libraries, bounded data-only KeyValues parsing, manifest/installation evidence and diagnostics. Referenced unselected libraries are never scanned automatically.

### Compatibility

- Contract range: `>=0.1.0 <0.2.0`; software: Steam `generic` (format integration, synthetic-fixture validation, not an all-version guarantee).
- No network enrichment, executable discovery, launch or game-file mutation is implemented. This Extension versions independently of core.

[English](CHANGELOG.md) | [中文](docs/zh/CHANGELOG.md)
