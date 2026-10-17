# Konogame (このゲーム)

Konogame is an early-stage extensible framework for managing game assets: saves, patches, mods, notes, tools, and unusual formats. This repository currently contains a TypeScript architecture skeleton, a filesystem save-store prototype, and a TOML Workspace inspection/rename experiment, not a production game manager. The initial design and code were developed with AI assistance.

## Design

[Project metadata](konogame-metadata.toml) owns the current version and compatibility declarations. Core binaries/packages share a release version; each Extension versions independently. See the [changelog](CHANGELOG.md) and [release maintenance guide](docs/en/003-RELEASE-MAINTENANCE.md).

A **Module** organizes user-facing **Features**. Each Feature invokes an **Operation** through a replaceable **Port/Contract**. An **Extension** can ship multiple **Adapters**. Each Adapter advertises its operations and fine-grained **Capabilities**. The application negotiates requirements against available Adapters and produces a **Binding Plan** before work runs.

CLI and daemon are separate entry points using the same application service. They do not depend directly on Kopia, Ludusavi, or another vendor tool. Core packages, including the Contract package, share a release version; the protocol has its own version and Extensions release independently. The default filesystem Adapter streams multi-file Artifacts and does not require version history.

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
just daemon
```

`just setup` installs the pinned tools and workspace dependencies. The CLI writes saves under `~/.konogame/saves` by default. Set `KONOGAME_SAVE_ROOT` to change it. The daemon prototype binds to `127.0.0.1:38417` and exposes `GET /health` and `GET /plan?feature=save.store`; it does not yet run save jobs.

Build before running package entry points. Each package exports its own tsdown-generated ESM JavaScript and declarations from `dist`; Vitest runs tests. `just check` forwards to `pnpm check`, which runs Biome, builds, checks types, runs tests, and validates docs and release metadata. `just typecheck` and `just test` forward to the matching pnpm scripts. `just dev-cli` runs repository tooling, including release maintenance. The oclif CLI offers clack prompts on a TTY; running without a command opens a menu, and missing arguments can be requested. `--non-interactive`, `--interactive=false`, or `INTERACTIVE=false` disable prompts (flags > environment > TTY). JSON/non-TTY execution never prompts; cancellation does not write.

Human Workspace configuration uses TOML 1.0 (`workspace.experimental.3`); machine JSON output, JSON Schema, and Artifact manifests remain JSON. UUIDv7 identifies records; `uniformName` supplies a readable Unicode filename suffix. See the experiment and ADR 0002 below for both layouts, explicit clears, Host roots, rename recovery, and limits.

TypeScript uses shared options in `tsconfig.base.json`, per-workspace `tsconfig.json` files, and root project references. The `monorepo-tsc` export condition points editor navigation and type checking directly to workspace sources; normal runtime imports use `dist`. `just typecheck` forwards to `pnpm typecheck`, which runs the project graph with `tsc --build`, writing declarations and incremental metadata to ignored `dist-tsc/` directories. Tests and build tooling have separate TypeScript projects. Root and workspace `tsconfig.json` files contain only references to role-specific `tsconfig.app.json`, `tsconfig.lib.json`, `tsconfig.tool.json`, and `tsconfig.test.json` projects as applicable. Each package has its own test project, which references production dependencies and is excluded from production builds. Vitest groups colocated `__tests__/*.test.ts` unit tests, package `tests/integration/*.test.ts` integration tests, and package or repository `tests/e2e/*.test.ts` end-to-end tests. Run one group with `just test --project unit`, `integration`, or `e2e`.

`just lint` checks formatting, recommended lint rules, and import organization with [Biome](https://biomejs.dev/reference/configuration/); `just format` applies formatting and safe fixes. The project uses two-space indentation, LF, double quotes, inline type specifiers (`import { A, type B }`), and rejects both `enum` and `const enum`. Guarded non-null assertions remain allowed. Generated release sources are excluded, and package manifests retain the release synchronizer's formatting. Git-ignored build outputs and private `projections/` are excluded.

## Repository map

- `packages/contracts`: versioned vocabulary and streaming Artifact contracts.
- `packages/workspace`: Workspace Module, configuration/history contracts, record schemas, and override rules.
- `packages/save`: the Save Module's initial six Feature/Port definitions.
- `packages/application`: negotiation, adapter resolution, and shared application service.
- `extensions/filesystem`: filesystem save-store and Workspace configuration Adapters.
- `apps/cli`, `apps/daemon`: separate frontends; `apps/shared` is `@konogame/local-runtime`, with `src/index.ts` as its composition entry.
- `scripts/dev-cli`: repository tooling workspace with `src/main.ts`, including documentation checks.
- `justfile`: daily command recipes. They forward to pnpm workspace scripts and the built Node entry points.

## Documentation

- [Current architecture](docs/en/001-ARCHITECTURE.md)
- [Changelog](CHANGELOG.md)
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

[English](README.md) | [中文](docs/zh/README.md)
