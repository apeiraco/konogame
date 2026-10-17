# Konogame agent guide

## Communication and language

- Chat with the user in user language. For example, if user uses Chinese, chat in Chinese. If user uses English, chat in English.
- Write code identifiers and comments in English. Comments explain why.
- Maintain English and Chinese versions for user-facing architecture, ADR, roadmap, and README changes. Keep machine-oriented files in English.

## Source of truth

- Read `README.md` and `docs/en/001-ARCHITECTURE.md` before changing architecture.
- Current decisions are in `docs/{lang}/adr/`; future work is in `docs/{lang}/roadmap/`.
- `konogame-metadata.toml` is the canonical source for project metadata, the shared core release version, Contract protocol/range declarations, and independently versioned Extensions. Maintain package manifests and generated runtime metadata with `just dev-cli release sync`. Agents may call the forwarded `pnpm dev-cli release sync`. Never edit generated version/metadata files directly.
- Core binaries/packages share one release version. Each Extension has an independent version and declares its Contract range and corresponding software versions in its own `software` map. Software may use SemVer ranges, `latest` for unpinned/insufficiently tested support, or `generic` for protocol/format compatibility. Contract ranges must be valid SemVer ranges. Do not introduce a separate integration registry or provider concept.
- Maintain root `CHANGELOG.md` and `docs/zh/CHANGELOG.md` together; `docs/en/CHANGELOG.md` is a relative symlink to the root source. Core release sections use the version; Extension sections use `<extension-id>@<version>`. Version maintenance does not manufacture release notes.
- `docs/{lang}/archive/` contains historical proposals and discussion records. Do not treat their Rust server, plugin tiers, IPC, or database choices as current contracts.
- Preserve unrelated local Git changes and untracked files.
- During the local experimental phase, allow breaking schema/API changes. Do not add historical migration or backward-compatibility scaffolding unless explicitly requested; preserve user data and report incompatible records.
- `projections/` contains ignored links to private experimental Workspaces. Read their applicable instructions before writing. Keep real paths, account identifiers, and observed game inventories out of public fixtures; use synthetic test data.

## Multi-language documentation

- Use `docs/en/` and `docs/zh/` for English and Chinese. Keep filenames identical across languages, without language suffixes.
- Keep current topic documents flat as `docs/{lang}/00x-TITLE.md`, accepted ADRs under `docs/{lang}/adr/000x-TITLE.md`, and future proposals and plans under `docs/{lang}/roadmap/00x-TITLE.md`.
- Move superseded designs and historical discussion records into `docs/{lang}/archive/`. Keep their original content, updating notices and links as needed. Release history belongs in `CHANGELOG.md` when present.
- English convention documents (`README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and `PRIVACY.md`, when present) have suffixless repository-root sources. Expose them under `docs/en/` through tracked relative symlinks; keep translations as regular files under `docs/{lang}/`. Do not maintain duplicate homepages or a separate `docs/README.md`.
- Translate user-facing documents, not machine-oriented instructions such as `AGENTS.md`. Archived records may remain in their original language when no translation exists.
- End each current user-facing document with both English and 中文 language links to canonical sources. Link paired archived documents in both directions; do not invent translations for unpaired records.
- Link to documents in the same language whenever available. Resolve links in symlink projections relative to the canonical source.
- `just dev-cli check-docs` recursively checks both language trees, including ADRs, roadmap, and archive, and checks each canonical source once. Agents may call the forwarded `pnpm dev-cli check-docs`.

## Boundaries

- TypeScript is the initial implementation language. Use pnpm workspaces and mise for tooling. `just` is the user-facing command entry.
- Prefer modern native APIs supported by the target runtime, such as `Temporal`, `Intl`, `import.meta`, and `node:util`'s `styleText`. Use legacy APIs such as `Date` only in small, isolated conversions required at external-library boundaries. Do not add or use legacy utility libraries whose functionality is largely covered by modern native APIs; verify runtime support before choosing an API.
- Biome owns formatting, recommended lint rules, and import organization. Use two spaces, LF, double quotes, and inline type specifiers (`import { A, type B }`). Reject `enum` and `const enum`; preserve generated release projections. Use `just lint` to check and `just format` for formatting and safe fixes.
- Target Node 26 ESM. Export callable functions from entry modules and execute only under `import.meta.main`; importing CLI, daemon, or dev-cli modules must have no startup side effects. Use `import.meta.dirname` and `import.meta.filename` where needed.
- Build each package with tsdown without bundling into its own `dist` JavaScript and declarations; package exports target built artifacts. Run `just build` before using package entry points. Use Vitest for tests.
- Share TypeScript options in `tsconfig.base.json`. Root and workspace `tsconfig.json` files are references-only solutions for `tsconfig.{app|lib|tool|test}.json`; each package has a dedicated `tsconfig.test.json`. Reference production dependencies explicitly and exclude tests from production projects.
- Put the `monorepo-tsc` source condition before `types`/`import` in workspace exports; enable it through TypeScript `customConditions` so editor navigation and type checking use source. Normal runtime exports use `dist`. `just typecheck` forwards to `pnpm typecheck`, which runs `tsc --build`, with declarations, declaration maps, and incremental metadata in ignored `dist-tsc/` directories.
- `apps/shared` is the `@konogame/local-runtime` workspace with `src/index.ts`; repository tooling belongs to the `scripts/dev-cli` workspace with `src/main.ts`.
- Use `@oclif/core` explicit CLI commands and `@clack/prompts` for TTY menus/missing arguments. Respect flags > environment > TTY, disable prompts for JSON/non-TTY execution, and do not write on cancellation.
- Human Workspace configuration is TOML 1.0; machine output, JSON Schema, and Artifact manifests remain JSON. Keep the common JSON-compatible value subset, explicit `settings.clear`, and schema 3 rules; reject null, dates/times, non-finite numbers, and unsafe integers.
- Generate lowercase UUIDv7 for new Workspace/entity and Artifact IDs. UUID alone is identity; preserve original `uniformName` and the versioned `unicode-fs-v1` filename codec. Keep flat/directory record layouts equivalent and reject duplicate UUIDs.
- Keep rename on the existing configuration Port with `configuration.rename`; preserve comments, layout, UUID references, and Host companion containers. Keep lock/revision/hash/recovery behavior scoped to this workflow, with visible conflicts and recovery-required failures. Host roots are arbitrary absolute-path aliases; discovery scan scope is separate from source declarations.
- CLI and daemon are process boundaries. Put shared workflows in `packages/application`; call module ports, not vendor tools.
- Keep Module, Feature, Port/Contract, Operation, Capability, Extension, Adapter, and Binding Plan distinct. A capability such as history support is not a sub-feature.
- Game, Host, and Installation are entities, not implementation providers. Workspace uses the same Module/Feature/Port/Adapter binding flow; Provider only describes an Adapter's supplying role, never a second registry or protocol. Use `adapterId`, `adapterOptions`, and source `kind` for their distinct purposes.
- Define finite value sets with `const X = { ... } as const; type X = (typeof X)[keyof typeof X]`. Reuse those values in schemas and discriminants; do not use TypeScript enums or standalone literal-union type declarations.
- An Extension may contribute several Adapters. Resolve each requested Feature against contract version, operation, and required capabilities before execution. Explicit preferences fail visibly if incompatible.
- Treat Artifact as an opaque cross-module collection of streamed files and metadata. Avoid buffering a whole game asset or assuming one file.
- Filesystem storage is the default. Do not require snapshot history, network sync, or a running daemon for basic local work.
- Keep experimental integrations behind ports. Do not add Kopia, Ludusavi, OpenDAL, Trilium, Syncthing, Rclone, or RustFS as core dependencies without a concrete use case.

## Command entry

- `just` is the user-facing command entry. Every daily command needs a root `justfile` recipe that forwards to the tool owning that scope. Forward positional arguments with `recipe_args`. On Windows, Just invokes PowerShell 7 so argv stays intact; Unix shells pass native positional parameters.
- pnpm owns workspace scripts such as `build`, `typecheck`, `test`, and `check`. Node owns the built CLI, daemon, and dev-cli modules. Future Cargo and uv commands stay in their own scope the same way. Agents may call those tools directly for scoped work.
- `just setup` installs pinned mise tools and workspace dependencies. `just build`, `just typecheck`, `just test`, and `just check` forward to the matching pnpm scripts. `just cli`, `just daemon`, and `just dev-cli` run the built Node entries and require a prior build.
- Recipe comments are the command reference. Use `just --list`. Add a forwarding recipe when a command becomes part of daily use.

## Verification

- Run `just check` after changing the TypeScript skeleton or current docs. It forwards to `pnpm check`, which runs Biome, builds artifacts, checks types, runs Vitest, checks docs, and validates release metadata/notes. Agents may run `pnpm check` directly.
- Use Vitest: colocate unit tests in `__tests__/*.test.ts`, package integration tests in `tests/integration/*.test.ts`, and package or repository e2e tests in `tests/e2e/*.test.ts`. Filter with `just test --project unit|integration|e2e`; cover behavior that could regress, especially binding and streams.
- Do not modify unrelated files or erase user work to make checks pass.

## Documentation index

- [Project overview](README.md) · [中文](docs/zh/README.md)
- [Current architecture](docs/en/001-ARCHITECTURE.md) · [中文](docs/zh/001-ARCHITECTURE.md)
- [Release maintenance](docs/en/003-RELEASE-MAINTENANCE.md) · [中文](docs/zh/003-RELEASE-MAINTENANCE.md)
- [Changelog](CHANGELOG.md) · [中文](docs/zh/CHANGELOG.md)
- [Local Workspace experiment](docs/en/002-WORKSPACE-EXPERIMENT.md) · [中文](docs/zh/002-WORKSPACE-EXPERIMENT.md)
- [Capability binding ADR](docs/en/adr/0001-CAPABILITY-BINDING.md) · [中文](docs/zh/adr/0001-CAPABILITY-BINDING.md)
- [Workspace TOML and tooling ADR](docs/en/adr/0002-WORKSPACE-TOML-AND-TOOLING.md) · [中文](docs/zh/adr/0002-WORKSPACE-TOML-AND-TOOLING.md)
- [Release versions and compatibility ADR](docs/en/adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) · [中文](docs/zh/adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)
- [Initial iterations](docs/en/roadmap/001-INITIAL-ITERATIONS.md) · [中文](docs/zh/roadmap/001-INITIAL-ITERATIONS.md)
- [Workspace configuration proposal](docs/en/roadmap/002-WORKSPACE-CONFIGURATION.md) · [中文](docs/zh/roadmap/002-WORKSPACE-CONFIGURATION.md)
- [Game discovery proposal](docs/en/roadmap/003-GAME-DISCOVERY.md) · [中文](docs/zh/roadmap/003-GAME-DISCOVERY.md)
- [Frontend experience proposal](docs/en/roadmap/004-FRONTEND-EXPERIENCE.md) · [中文](docs/zh/roadmap/004-FRONTEND-EXPERIENCE.md)
- [Historical archive](docs/en/archive/README.md) · [中文](docs/zh/archive/README.md)
