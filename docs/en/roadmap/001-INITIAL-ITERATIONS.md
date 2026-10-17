# Initial iterations

Status: iterative plan, updated 2026-10-17. The current implementation includes a TypeScript contract/application skeleton, streaming filesystem save-store, CLI/daemon prototypes, and the [TOML Workspace inspection/rename experiment](../002-WORKSPACE-EXPERIMENT.md). Broader Workspace editing, game discovery, configuration history, graphical UI, and durable jobs remain unimplemented. Experimental schemas/APIs may break; historical migration and backward-compatibility layers are out of scope.

## Proposal index

| Proposal | First outcome | Main dependency |
| --- | --- | --- |
| [Workspace configuration and versioning](002-WORKSPACE-CONFIGURATION.md) | File-based records, stable Game/Installation identities, effective configuration inspection, and revision-aware edits. | Record Schema, validation, and a clear write unit. Optional history follows basic editing. |
| [Game discovery](003-GAME-DISCOVERY.md) | Bounded discovery, sourced candidates, review, and explicit Workspace admission. | Workspace identity and update rules; discovery source and evidence contracts. |
| [Frontend experience](004-FRONTEND-EXPERIENCE.md) | Management views for configuration/discovery and truthful action/task state, followed by play-mode navigation. | Shared application-client boundary, available workflows, and task lifetime semantics. |

The proposals recover useful intent from the archive and adapt it to the current architecture. [ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md) accepts the TOML, identity, rename, and tooling baseline; the remaining proposals do not imply supported commands. Early UI fixtures can clarify contracts while Workspace work proceeds, but real UI writes depend on the same application services as the CLI.

## Suggested implementation order

### 1. Contracts and a local Workspace

Harden error types, cancellation, progress, stream ownership, capability parameters, current-contract checks, and Extension manifest validation as required by the first workflows. Add inspection of full Binding Plans, preserving visible failure for incompatible explicit preferences. Do not build backward-compatibility scaffolding during this experiment.

The slice uses TOML 1.0 schema 3, lowercase UUIDv7 identities, original uniform names, equivalent flat/directory layouts, separate portable/local files, seven override layers, and validation with provenance. Workspace inspection and dedicated rename share Save's binding resolver and Extension/Adapter descriptors. Explicit clears, arbitrary Host root aliases, typed installation locations, Unicode filename encoding, and comment-preserving rename are accepted in ADR 0002. Application writer locks, revision/hash checks, and targeted recovery keep rename narrow; arbitrary external-editor races remain a documented limit. Automated discovery remains unimplemented; public fixtures are synthetic.

Next review synthetic standalone-directory and multi-installation cases, then add broader previewed edits with explicit revision/recovery limits. Keep filesystem use independent of Git and a running daemon. Accept breaking schema revisions without a migration subsystem; changes to existing files must still be deliberate and reviewable.

Exit: a local CLI can inspect and rename an entity, then extend reviewed updates, explain its effective values, and reject a stale edit without losing user changes. Contract and stream behavior have focused regression tests.

### 2. Discovery admission and the first save workflow

Define Game discovery/identity boundaries and their distinction from `save.discover`. Start with one bounded local source, streamed candidates, evidence, cancellation, and review before admission. After Steam/manual observations, expand to Epic, Xbox managed locations, and Ubisoft/EA cases. Preserve distinct source references when several launchers describe one installation. Use a second source fixture to verify deterministic merging and partial failure; do not change the existing single-request resolution rule implicitly.

Connect save location discovery, export, filesystem storage, and explicit import/restore policies for one supported case. Handle multi-file streams and explain partial effects. Add conversion only when a concrete format pair defines its semantics. Evaluate Ludusavi-backed save knowledge as the next source; defer online metadata and AI until local review and admission work.

Exit: an explicitly selected location yields reviewable candidates; admission preserves user corrections and avoids duplicates. A known save can be exported, stored, and deliberately imported with a clear effect preview.

### 3. Management UI, then play interaction

Select the first local host and a small shared application-client interface. Prototype configuration differences, discovery review, action availability, and task feedback with clearly labeled fixtures, then connect implemented services. Display foreground lifetime limits before introducing background operation.

Define launch semantics before enabling real play actions. Add the play-mode library/detail flow, keyboard/controller navigation, focus restoration, and reduced-motion behavior. The UI consumes application availability and results rather than selecting vendor tools itself.

Exit: supported workflows can be followed through the management UI, unavailable capabilities have explanations, and play navigation works without losing focus. Completion notifications recommend explicit actions rather than automatically launching a game.

### 4. Optional history and external adapters

After basic Workspace editing, implement the recommended history contract in a disposable Git experiment: managed portable paths, an independent history ref/index, expected-head checks, idempotent operation IDs, and restoration through application validation. Verify preservation of the user's branch/index before live use. Keep configuration revisions separate from asset snapshots; report file-write/history-recording partial failures without promising a cross-system transaction. The current history interface is a sketch, not an implementation.

Prototype Kopia for snapshot/blob infrastructure and optional asset history, and OpenDAL for backend configuration and storage/replication. Define concrete uses for Blob, Snapshot, and Replication Ports before expanding their contracts. Independently test each Adapter against contract fixtures and large-file streams. Basic filesystem work must remain available without these adapters.

Exit: each optional integration has a documented supported scope, clear capability availability, and independent contract tests; disabling history does not disable ordinary storage or configuration editing.

### 5. Additional assets and delivery decisions

Introduce Patch and Notes Modules after defining their Features and Artifacts. Evaluate Trilium for notes; keep Syncthing, Rclone, and RustFS in transport/backend roles. Configuration rollback must not imply undoing applied patches or other asset operations.

Use separate ADRs for daemon transport and authentication, background task ownership and recovery, Extension loading/isolation, independently published contracts and extensions, compatibility policy, desktop packaging, remote clients, and additional platforms. Select concrete use cases before adding dependencies or promising durable jobs and mobile parity.

Exit: each delivery increment has a runnable scope, a published compatibility boundary where applicable, and documented failure/recovery behavior. These decisions may be made earlier when a preceding slice requires them.

## Decision and documentation policy

Node 26 ESM entry modules export functions and use `import.meta.main` guards. Packages build separate tsdown JavaScript/declarations without bundling and export `dist`; shared composition is `@konogame/local-runtime`, and repository tooling is the `scripts/dev-cli` workspace. The oclif/clack CLI supports TTY menus and missing arguments while JSON/non-TTY runs never prompt. Vitest supplies tests. `just check` forwards to `pnpm check`, which runs build, typecheck, tests, and docs.

Each implementation stage should produce a runnable vertical slice and focused tests against its acceptance targets. Keep proposed work in `roadmap/`, record durable accepted decisions in `adr/`, and document implemented experimental behavior in current topic documents. Preserve archived records as background; their Rust server, fixed plugin tiers, and mandatory daemon assumptions do not become requirements. Keep private observations in the lab and publish only synthetic or deliberately anonymized fixtures.

[English](001-INITIAL-ITERATIONS.md) | [中文](../../zh/roadmap/001-INITIAL-ITERATIONS.md)
