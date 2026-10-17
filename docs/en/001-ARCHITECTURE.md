# 01 Current architecture

Status: initial contracts, filesystem storage, and TOML Workspace inspection/rename prototype; not a complete game manager.

## Vocabulary and flow

| Term | Meaning |
| --- | --- |
| Module | Owns a domain, including asset or Workspace management, and groups user-facing Features. |
| Feature | A task a user requests, such as `save.store` or `save.history`. |
| Port/Contract | Replaceable boundary with independently versioned input/output semantics. |
| Operation | A verb on a Port, such as `put`, `open`, or `list`. |
| Capability | A fine-grained Adapter property, such as `artifact.streaming` or `history.versioned`. |
| Extension | Independently distributable package that may supply several Adapters. |
| Adapter | One Extension's implementation of one Port, advertising operations and capabilities. |
| Binding Plan | Result of capability negotiation and Adapter resolution, including bindings and unavailable requests. |

`CLI / Daemon -> application service -> Feature -> Port Operation -> resolved Adapter`. CLI and daemon compose the same service. An Extension may implement Ports across several Modules; Module code never imports a vendor implementation. Resolution checks contract version, operation, and all required capabilities. An explicit preferred Adapter does not silently fall back. The actual Contract protocol is `0.1.0`; Modules and Adapters declare compatible SemVer `contractRange` values. Core binaries/packages share release version `0.1.0-alpha.0`, while each Extension has an independent release version and software compatibility declarations. Dynamic discovery remains future work. See [ADR 0003](adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) and [release maintenance](003-RELEASE-MAINTENANCE.md).

Provider describes the supplying role of an Adapter or configured Adapter instance. It is not another extension type, registry, or contract system. Game, Host, and Installation are entities; their records do not each require a Module or a Provider.

Finite value sets use `const X = { ... } as const` and `type X = (typeof X)[keyof typeof X]`. Schemas and discriminants reuse the constants; TypeScript enums and standalone literal-union declarations are not used.

## Artifact and infrastructure

Artifact is opaque to unrelated Modules: a media type, metadata, and an asynchronous sequence of files. Each file opens a byte stream on demand. A consumer must not require a single archive, a whole-artifact buffer, or a pathname meaningful to another Module. Paths inside an Artifact are safe relative names. New Artifact IDs use lowercase UUIDv7. The manifest remains machine JSON. The filesystem Adapter writes a manifest and streamed copies into a new directory; it does not expose version history.

Reusable infrastructure Ports are `BlobPort` (bytes), `SnapshotPort` (point-in-time reference), and `ReplicationPort` (copy to another location). These are distinct from user-facing Features and have interfaces only at this stage. A Module can use them without requiring every adapter to support all three.

## First Module: Save

Save starts with six Ports and Features: `save.discover`, `save.export`, `save.import`, `save.convert`, `save.store`, and `save.history`. Store uses `put` and `open`; history uses `list` plus `history.versioned`. Filesystem currently implements only `save.store`. Other Ports describe integration boundaries, not working commands. History is optional.

## Workspace configuration experiment

`packages/workspace` defines the Workspace Module, its contracts, strict experimental records, and pure override rules. `packages/application` resolves its Features through the same `resolveBindings` path as Save, dispatches to a registered implementation, and inspects effective values. CLI and daemon share the same composition; the daemon exposes planning, while CLI also runs Workspace inspection and entity rename.

| Feature | Port / Operation | Required Capability | Current implementation |
| --- | --- | --- | --- |
| `workspace.inspect` | `workspace.configuration` / `read` | `configuration.records` | `filesystem.workspace-configuration`, shipped by the filesystem Extension. |
| `workspace.rename` | `workspace.configuration` / `rename` | `configuration.rename` | `filesystem.workspace-configuration`, dedicated rename and recovery workflow. |
| `workspace.history` | `workspace.history` / `list` | `history.versioned` | No history Adapter is shipped. |

Contract version, Operation, Capability, and explicit preference are checked before configuration I/O. Inspection returns the selected Binding Plan. Descriptor compatibility and an active runtime instance are separate requirements; a missing instance cannot execute. History availability uses the same resolver and checks the active implementation registry, without automatically running history operations.

Bootstrap root and optional configuration Adapter preference come from the caller. They cannot depend on the file being loaded. Schema export and pure validation/override functions need no replaceable implementation and remain ordinary functions. `adapterOptions` holds Adapter configuration; `history.mode` disables history or requires `adapterId` in adapter mode; source `kind` identifies an open source category such as a launcher, not an Adapter.

Portable Game records are separated from local Host/Installation records. Schema changes may break experimental files; no historical migration or compatibility reader is provided. Human configuration uses TOML 1.0, experimental schema 3, and a JSON-compatible value subset without null/date/time/non-finite/unsafe-integer values. Machine output, JSON Schema, and Artifact manifests remain JSON. Lowercase UUIDv7 is the sole identity; Game/Host/Installation retain original `uniformName` and use the versioned `unicode-fs-v1` NFC/percent filename codec in equal flat/directory layouts. Explicit clears replace nullable configuration settings. Host roots are arbitrary local absolute-path aliases; Installation locations are `fs.absolute`, `fs.relative`, or `managed`; source declarations do not define scan roots.

Rename preserves comments, unaffected TOML, layout, UUIDs, and references. It coordinates writers with a lock, revision/hash checks, temporary content, and recovery state; collisions do not overwrite and failed rollback requires recovery. Same-entity/target retry does not establish a general transaction system or atomic protection against arbitrary external editors. Generic editing, configuration history, discovery, launch, and using configuration to execute asset operations remain future work. [ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md) records these decisions. See the [implemented scope](002-WORKSPACE-EXPERIMENT.md) and [recommendations](roadmap/002-WORKSPACE-CONFIGURATION.md).

## Entry points and builds

Node 26 ESM entry modules export functions and execute only under `import.meta.main`; imports do not start processes. Use `import.meta.dirname`/`import.meta.filename` rather than reconstructed paths. `@konogame/local-runtime` (`apps/shared/src/index.ts`) composes shared dependencies. Each package builds separate JavaScript/declarations with tsdown without bundling, and exports `dist` artifacts. The dev-cli is a workspace under `scripts/dev-cli/src/main.ts`. Vitest supplies tests. Daily commands enter through `just` and forward to the owning tool: `just check` forwards to `pnpm check`, which runs Biome, build, typecheck, tests, docs, and release metadata checks. pnpm, Node, and future Cargo or uv commands remain available for their own scope and for agents.

The CLI uses oclif explicit commands and clack TTY assistance. No-command menus and missing-argument prompts respect flags > environment > TTY. `--non-interactive`, `--interactive=false`, and `INTERACTIVE=false` disable prompting; JSON/non-TTY execution never prompts and cancellation does not write.

TypeScript projects share `tsconfig.base.json` and use per-workspace configurations with dependency references. The root solution references those projects plus separate tests and build-tooling projects. `customConditions: ["monorepo-tsc"]` selects source entries placed before `types`/`import` in workspace exports, so the editor resolves source without waiting for a package build. Normal runtime imports continue to select `dist`. `just typecheck` forwards to `pnpm typecheck`, which uses `tsc --build`; its declaration maps and incremental outputs stay in ignored `dist-tsc/`, separate from tsdown artifacts. Root and workspace `tsconfig.json` files contain only references to role-specific `tsconfig.app.json`, `tsconfig.lib.json`, `tsconfig.tool.json`, and `tsconfig.test.json` projects as applicable. Each package has its own test project, which references production dependencies and is excluded from production builds. Vitest groups colocated `__tests__/*.test.ts` unit tests, package `tests/integration/*.test.ts` integration tests, and package or repository `tests/e2e/*.test.ts` end-to-end tests. Run one group with `just test --project unit`, `integration`, or `e2e`.

## Integration map


- **Ludusavi**: future discovery/export/import Adapter for saves; it is not the storage layer.
- **Kopia**: future snapshot/blob infrastructure Adapter, potentially shared by Save and Patch Modules; versioning stays optional.
- **OpenDAL**: future storage/replication Adapter and configuration mapping for backends; core does not parse adapter-specific options.
- **Trilium**: future notes, guide, and achievement-log Module integration.
- **Syncthing / Rclone / RustFS**: transport or backend roles beneath replication/storage. Syncthing can synchronize filesystem replicas, Rclone can reach remote targets, and RustFS can supply an S3 endpoint. They are not Save Module APIs.

Earlier designs remain in the [historical archive](archive/README.md). Windows mounting, UI, launch orchestration, external process protocol, and persistence policy need separate decisions before implementation.

[English](001-ARCHITECTURE.md) | [中文](../zh/001-ARCHITECTURE.md)
