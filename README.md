# Konogame (このゲーム)

Konogame is an early-stage extensible framework for managing game assets: saves, patches, mods, notes, tools, and unusual formats. This repository currently contains a TypeScript architecture skeleton, a filesystem save-store prototype, a TOML Workspace initialization, reviewed single-record editing and inspection/rename experiment, and local Steam/standalone discovery with reviewed admission, not a production game manager. The initial design and code were developed with AI assistance.

## Design

[Project metadata](konogame-metadata.toml) owns the current version and compatibility declarations. Core binaries/packages share a release version; each Extension versions independently. See the [changelog](CHANGELOG.md) and [release maintenance guide](docs/en/003-RELEASE-MAINTENANCE.md).

A **Module** organizes user-facing **Features**. Each Feature invokes an **Operation** through a replaceable **Port/Contract**. An **Extension** can ship multiple **Adapters**. Each Adapter advertises its operations and fine-grained **Capabilities**. The application negotiates requirements against available Adapters and produces a **Binding Plan** before work runs.

CLI and daemon are separate entry points. Each one composes the Layers of the modules it uses. They do not depend directly on Kopia, Ludusavi, or another vendor tool. Core packages, including the Contract package, share a release version; the protocol has its own version and Extensions release independently. The default filesystem Adapter streams multi-file Artifacts and does not require version history.

## Try the prototype

Requires Node 26 and pnpm 12. mise pins the repository tools, including just. On Windows, Just runs recipes through PowerShell 7 so arguments stay native argv.

`just` is the daily command entry. Each recipe forwards to the tool that owns that scope: pnpm runs workspace scripts, and Node runs the built CLI, daemon, and dev-cli. pnpm, Node, and future Cargo or uv commands remain available for their own scope and for agents. `just --list` lists the recipes.

```sh
just setup
just check
just build
just cli features
just cli plan save.store
just cli save store path/to/a/save-directory
just cli workspace schema
just cli workspace inspect path/to/a/workspace
just cli workspace rename path/to/a/workspace <record-id> <uniform-name>
just cli game discover /synthetic/workspace --host-id <host-id> --source-id loose --scope /synthetic/games --json > /synthetic/preview.json
just cli game import /synthetic/workspace /synthetic/preview.json --candidate <candidate-key> --yes --json
just cli workspace recover-import /synthetic/workspace <operation-id> --yes --json
just daemon
```

`just setup` installs the pinned tools and workspace dependencies. The CLI writes saves under `~/.konogame/saves` by default. Set `KONOGAME_SAVE_ROOT` to change it. The daemon prototype binds to `127.0.0.1:38417` and exposes `GET /health` and `GET /plan?feature=save.store`; it does not yet run save jobs.

Build before running package entry points. Each package exports its own tsdown-generated ESM JavaScript and declarations from `dist`; Vitest runs tests. `just check` forwards to `pnpm check`, which runs Biome, builds, checks types, runs tests, and validates docs and release metadata. `just typecheck` and `just test` forward to the matching pnpm scripts. `just dev-cli` runs repository tooling, including release maintenance. The Optique CLI offers clack prompts on a TTY; running without a command opens a menu, and missing arguments can be requested. `--non-interactive`, `--interactive=false`, or `INTERACTIVE=false` disable prompts (flags > environment > TTY). JSON/non-TTY execution never prompts; cancellation does not write.

Human Workspace configuration uses TOML 1.0 (`workspace.experimental.4`); machine JSON output, JSON Schema, and Artifact manifests remain JSON. UUIDv7 identifies records; `uniformName` supplies a readable Unicode filename suffix. See the experiment and ADR 0002 below for both layouts, explicit clears, Host roots, rename recovery, and limits.

TypeScript uses shared options in `tsconfig.base.json`, per-workspace `tsconfig.json` files, and root project references. The `monorepo-tsc` export condition points editor navigation and type checking directly to workspace sources; execution imports use `dist`. Test projects also enable the `test` condition for source-only replacement exports that production resolution leaves unavailable. `just typecheck` forwards to `pnpm typecheck`, which runs the project graph with `tsc --build`, writing declarations and incremental metadata to ignored `dist-tsc/` directories. Tests and build tooling have separate TypeScript projects. Root and workspace `tsconfig.json` files contain only references to role-specific `tsconfig.app.json`, `tsconfig.lib.json`, `tsconfig.tool.json`, and `tsconfig.test.json` projects as applicable. Each package has its own test project, which references production dependencies and is excluded from production builds. Vitest groups unit tests of one rule or service under `src/**/__tests__/`, complete user-workflow integration tests under workspace or repository `tests/integration/`, and executable workflow tests under workspace or repository `tests/e2e/`. Run one group with `just test --project unit`, `integration`, or `e2e`.

`just lint` checks formatting, recommended lint rules, and import organization with [Biome](https://biomejs.dev/reference/configuration/); `just format` applies formatting and safe fixes. The project uses two-space indentation, LF, double quotes, inline type specifiers (`import { A, type B }`), and rejects both `enum` and `const enum`. Guarded non-null assertions remain allowed. Generated release sources are excluded, and package manifests retain the release synchronizer's formatting. Git-ignored build outputs and private `projections/` are excluded.

Discovery requires an existing configured Host/source and explicit scan scope. Save preview JSON outside scanned directories; confirmation rechecks current configuration, evidence and bindings. Steam library references never expand scope. Standalone directories are candidates rather than certified games; new installations have empty `launchEntries`. No network enrichment, game launch or game-file mutation is included. Joint Game/Installation writes use targeted journal/forward recovery rather than an atomic multi-file transaction. See the [experiment guide](docs/en/002-WORKSPACE-EXPERIMENT.md) for flags and recovery limits, and the [development guide](docs/en/004-DEVELOPMENT.md) for domain responsibilities and Effect 4.0.6 Layer composition.

Each workflow is an owner-module `Context.Service` and Layer. CLI and daemon merge the Layers they need: infrastructure (registries, binding plans, extension catalog), Workspace management, game admission and save writes. Catalog-only acquisition prepares declarations; normal acquisition completes startup before exposing services. Add `packages/layer-composition` only when several cross-feature combinations cannot live in an existing module. See [ADR 0011](docs/en/adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md).

## Repository map

- `packages/infrastructure`: implementation registries, lazy activation, lifecycle, binding, Temporal/ID services, binding plans and the extension catalog.
- `packages/extension-discovery-node`: explicit installed-root JSON scanning and checked lazy factory loading; shares the core release version.
- `packages/contracts`: versioned vocabulary and streaming Artifact contracts.
- `packages/workspace`: Workspace Module, configuration/history contracts, record schemas, override rules, and inspection/edit workflows.
- `packages/workspace-configuration`: core TOML persistence, metadata layouts, read/rename/import/initialize/edit and targeted recovery; module-owned `core.workspace-configuration`.
- `packages/game`: local discovery contracts, candidate/evidence values, source capabilities, and admission workflows. It may depend on `workspace`.
- `packages/save`: the Save Module's Feature/Port definitions and the save-write workflow.
- `extensions/filesystem`: filesystem save-store, standalone discovery, native discovery I/O and `fs.absolute`/`fs.relative` Location definitions and behavior.
- `extensions/steam`: bounded local manifest discovery; independent Extension version and `steam = "generic"` software compatibility, tested with synthetic fixtures.
- `apps/cli`, `apps/daemon`: separate process entry points. Each entry merges owner Layers and selects bundled filesystem/Steam plus explicitly configured installed sources.
- `scripts/dev-cli`: repository tooling workspace with `src/main.ts`, including documentation checks.
- `justfile`: daily command recipes. They forward to pnpm workspace scripts and the built Node entry points.
- `temp/`: gitignored disposable files. Tests use `temp/tests/` under the repository root or the owning workspace; only the final entry is a random UUIDv7. See the [development guide](docs/en/004-DEVELOPMENT.md).

## Documentation

- [Current architecture](docs/en/001-ARCHITECTURE.md)
- [ADR 0010: Test boundaries and task graph](docs/en/adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)
- [ADR 0011: Effect contracts and lifetime](docs/en/adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)
- [ADR 0009: Application composition](docs/en/adr/0009-APPLICATION-COMPOSITION.md)
- [Changelog](CHANGELOG.md)
- [Workspace management](docs/en/008-WORKSPACE-MANAGEMENT.md)
- [ADR 0008: Workspace management](docs/en/adr/0008-WORKSPACE-MANAGEMENT.md)
- [Extension system comparison](docs/en/007-EXTENSION-SYSTEM-COMPARISON.md)
- [ADR 0007: Discovery and load robustness](docs/en/adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)
- [Services and Extension lifecycle](docs/en/006-SERVICES-AND-EXTENSION-LIFECYCLE.md)
- [ADR 0006: Service ownership and lazy activation](docs/en/adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)
- [Location and registries](docs/en/005-LOCATION-AND-REGISTRIES.md)
- [ADR 0005: Location registries and core persistence](docs/en/adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)
- [Development guide](docs/en/004-DEVELOPMENT.md)
- [ADR 0004: Local discovery and explicit injection](docs/en/adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md)
- [Release maintenance](docs/en/003-RELEASE-MAINTENANCE.md)
- [Local Workspace experiment](docs/en/002-WORKSPACE-EXPERIMENT.md)
- [ADR 0001: Capability binding](docs/en/adr/0001-CAPABILITY-BINDING.md)
- [ADR 0002: Workspace TOML and tooling](docs/en/adr/0002-WORKSPACE-TOML-AND-TOOLING.md)
- [ADR 0003: Release versions and compatibility](docs/en/adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)
- [Initial iterations](docs/en/roadmap/001-INITIAL-ITERATIONS.md)
- [Workspace configuration and versioning proposal](docs/en/roadmap/002-WORKSPACE-CONFIGURATION.md)
- [Game discovery proposal](docs/en/roadmap/003-GAME-DISCOVERY.md)
- [Frontend experience proposal](docs/en/roadmap/004-FRONTEND-EXPERIENCE.md)
- [Historical design archive](docs/en/archive/README.md)
- [Agent and documentation rules](AGENTS.md)

Current contracts live in `docs/{lang}/`, accepted decisions in `docs/{lang}/adr/`, and future work in `docs/{lang}/roadmap/`. Superseded designs live in `docs/{lang}/archive/`; their Rust server and fixed plugin-tier assumptions have been superseded. English convention documents use repository-root sources, with relative symlink projections in `docs/en/`. Translations live in their language directories.

Licensed under [MPL 2.0](LICENSE.md).

Location is a serializable `{ type, schemaVersion, data }` value; unknown types/schemas remain readable and preserved with unverified/unavailable status. Core configuration persistence is Module-owned and reads without Location registration. Resource behavior, comparison and typed resolution require compatible registered Adapters. See [ADR 0005](docs/en/adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) and the [Location guide](docs/en/005-LOCATION-AND-REGISTRIES.md).

Services, Ports and Context.Service tags live with their owner packages. Application composition assembles Layers, Scope owns application and generation resources, and private PubSub exposes read-only Streams. Manifests are cataloged before lazy Effect code activation. Live catalog changes preserve blocked/restart-required outcomes; explicit installed-root discovery is available, while marketplace and independent host reload are absent. See the [service/lifecycle guide](docs/en/006-SERVICES-AND-EXTENSION-LIFECYCLE.md). Contract protocol is `0.2.0` with range `>=0.2.0 <0.3.0`; Schema 4 and core/Extension release versions `0.1.0-alpha.0` remain unchanged.

Installed Extensions are discovered only under explicit `extensionRoots` or the `KONOGAME_EXTENSION_ROOTS` JSON array of absolute paths. `just cli extension list`, `status` and `refresh` inspects the catalog without startup/code activation; each CLI refresh affects only its short-lived process. Strict declarations, consistent catalog versions and cancellable phase deadlines are implemented; timeouts do not isolate or kill code. See the [VS Code/Theia source comparison](docs/en/007-EXTENSION-SYSTEM-COMPARISON.md) and [ADR 0007](docs/en/adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md).

Workspace management now initializes an existing directory with disabled history, adds Hosts, reviews limited metadata/settings/root/source edits, and queries/explains the game library. Edits preserve identities and unknown Location data; apply rebuilds a fresh review and recovery remains targeted metadata completion. No arbitrary configuration editor, launch or asset backup/restore is implied. See the [management guide](docs/en/008-WORKSPACE-MANAGEMENT.md) and [ADR 0008](docs/en/adr/0008-WORKSPACE-MANAGEMENT.md).

## Tests and task graph

Tests are classified by the boundary they verify: isolated rules/services are unit tests; composed services, injected CLI dispatch/prompts and process/module contracts are integration tests; built program entries with normal composition and real disposable Workspace workflows are end-to-end tests. A child process alone does not make a test end-to-end. `just test --project unit`, `integration`, or `e2e` selects a Vitest project. Turborepo schedules required `dist` builds for tests through pnpm; build artifacts use a local cache, while tests always execute. Direct `just cli`, `just daemon` and `just dev-cli` still require an explicit build. See [ADR 0010](docs/en/adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md) and the [development guide](docs/en/004-DEVELOPMENT.md).

[English](README.md) | [中文](docs/zh/README.md)
