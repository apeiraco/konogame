# 01 Current architecture

Status: initial contracts, filesystem storage, and TOML Workspace initialization, reviewed editing, inspection/rename and local discovery/admission prototype; not a complete game manager.

## Vocabulary and flow

| Term | Meaning |
| --- | --- |
| Module | Owns a domain and organizes user-facing Features. |
| Feature | A user-requested task that requires a Port Operation and optional Capabilities. |
| Port | An independently versioned, replaceable boundary that owns its Operations. |
| Operation | An action defined by a Port, such as `put`, `open`, or `list`. |
| Capability | An Adapter guarantee checked during selection, such as `artifact.streaming` or `history.versioned`. |
| Adapter | A Module- or Extension-owned implementation of a Port, declaring supported Operations and Capabilities. |
| Extension | An independently distributed package that can supply several Adapters. |
| Adapter Resolution Plan | A value recording resolved Adapters and requests that cannot be satisfied. |

The dependency model is **Feature → Port ← Adapter**. A Feature requests an Operation owned by its Port; the selected Adapter implements that Port. Module organizes domain Features, and Extension packages Adapter implementations for distribution. A contract describes a boundary's types, schemas and behavioral guarantees; it is not another architectural level. Capability requirements filter Adapters before execution and do not add method parameters. The call flow is `CLI / Daemon -> application service -> Port Operation -> selected Adapter`.

Resolution checks `portVersion` against `portVersionRange`, Operation, required Capabilities, and Location schemas. An incompatible explicit preference fails visibly. The separate declaration protocol uses `declarationProtocolVersion` and `declarationProtocolRange`; its version remains `0.2.0` with `>=0.2.0 <0.3.0`. Each Port has its own version: `game.discovery` is `0.3.0`, while existing other Ports stay `0.2.0`. Core packages share release version `0.1.0-alpha.0`; Extensions release independently. Bundled/injected sources support lazy activation and catalog management; explicit-root installed discovery is available. See [ADR 0013](adr/0013-PORTS-AND-ADAPTER-RESOLUTION.md) and [release maintenance](003-RELEASE-MAINTENANCE.md).

Provider describes the supplying role of an Adapter or configured Adapter instance. It is not another extension type, registry, or contract system. Game, Host, and Installation are entities; their records do not each require a Module or a Provider.

Finite value sets use `const X = { ... } as const` and `type X = (typeof X)[keyof typeof X]`. Schemas and discriminants reuse the constants; TypeScript enums and standalone literal-union declarations are not used.

Boundary validation accepts a Standard Schema or a JSON Schema document and evaluates it with arktype. Schemas that leave the process, including Location `dataSchema` and the Workspace JSON Schema export, are transmitted as JSON Schema. `@ark/json-schema` converts JSON Schema into arktype, and arktype `toJsonSchema` converts it back. Serializable Workspace records use only constraints that convert one-to-one. Configuration values take their number bounds from JSON Schema and otherwise use strings, booleans, arrays, and objects.

## Artifact and infrastructure

Artifact is opaque to unrelated Modules: a media type, metadata, and a Stream of files. Each file opens a byte Stream on demand, with handles owned by Scope. A consumer must not require a single archive, a whole-artifact buffer, or a pathname meaningful to another Module. Paths inside an Artifact are safe relative names. New Artifact IDs use lowercase UUIDv7. The manifest remains machine JSON. The filesystem Adapter writes a manifest and streamed copies into a new directory; it does not expose version history.

Reusable infrastructure Ports are `BlobPort` (bytes), `SnapshotPort` (point-in-time reference), and `ReplicationPort` (copy to another location). These are distinct from user-facing Features and have interfaces only at this stage. A Module can use them without requiring every adapter to support all three.

## First Module: Save

Save starts with six Ports and Features: `save.discover`, `save.export`, `save.import`, `save.convert`, `save.store`, and `save.history`. Store uses `put` and `open`; history uses `list` plus `history.versioned`. Filesystem currently implements only `save.store`. Other Ports describe integration boundaries, not working commands. History is optional.

## Workspace configuration experiment

`packages/workspace` defines the Workspace Module, its contracts, strict experimental records, pure override rules, and the inspection and edit workflows. `packages/game` admits discoveries and may depend on `workspace`. CLI and daemon each merge the owner Layers they need. The local daemon exposes the catalog, Workspace, Game and Save workflows over HTTP. Its route descriptions are available at `/api/openapi` and `/api/openapi.json`.

| Feature | Port / Operation | Required Capability | Current implementation |
| --- | --- | --- | --- |
| `workspace.inspect` | `workspace.configuration` / `read` | `configuration.records` | `workspace-toml.configuration`, owned by Extension `konogame.workspace-toml`. |
| `workspace.rename` | `workspace.configuration` / `rename` | `configuration.rename` | `workspace-toml.configuration`, dedicated rename and recovery workflow. |
| `workspace.import` | `workspace.configuration` / `import` | `configuration.import` | Additive selected Game/Installation admission with a local journal. |
| `workspace.recover-import` | `workspace.configuration` / `recover-import` | `configuration.import-recovery` | Explicit forward recovery of an existing import operation. |
| `workspace.initialize` | `workspace.configuration` / `initialize` | `configuration.initialize` | Existing-root initialization; workspace.toml last. |
| `workspace.recover-initialize` | `workspace.configuration` / `recover-initialize` | `configuration.initialize-recovery` | Approved initialization completion. |
| `workspace.edit` | `workspace.configuration` / `edit` | `configuration.edit` | Reviewed strict single-record intent. |
| `workspace.recover-edit` | `workspace.configuration` / `recover-edit` | `configuration.edit-recovery` | Approved edit completion. |
| `workspace.history` | `workspace.history` / `list` | `history.versioned` | No history Adapter is shipped. |

Port version, Operation, Capability, and explicit preference are checked before configuration I/O. Inspection returns the selected Adapter Resolution Plan. Descriptor compatibility and an active implementation are separate requirements; a missing instance cannot execute. History availability uses the same Adapter resolution flow, activating compatible implementations on demand without running a history operation.

Bootstrap root and optional configuration Adapter preference come from the caller. They cannot depend on the file being loaded. Schema export and pure validation/override functions need no replaceable implementation and remain ordinary functions. `adapterOptions` holds Adapter configuration; `history.mode` disables history or requires `adapterId` in adapter mode; source `kind` identifies an open source category such as a launcher, not an Adapter.

Portable Game records are separated from local Host/Installation records. Schema changes may break experimental files; no historical migration or compatibility reader is provided. Human configuration uses TOML 1.0, experimental schema 4, and a JSON-compatible value subset without null/date/time/non-finite/unsafe-integer values. Machine output, JSON Schema, and Artifact manifests remain JSON. Lowercase UUIDv7 is the sole identity; Game/Host/Installation retain original `uniformName` and use the versioned `unicode-fs-v1` NFC/percent filename codec in equal flat/directory layouts. Explicit clears replace nullable configuration settings. Host roots are context passed to relevant Adapters; core does not interpret filesystem paths. Installation stores only `{ type, schemaVersion, data }`; source declarations do not define scan roots.

Rename preserves comments, unaffected TOML, layout, UUIDs, and references. It coordinates writers with a lock, revision/hash checks, temporary content, and recovery state; collisions do not overwrite and failed rollback requires recovery. Same-entity/target retry does not establish a general transaction system or atomic protection against arbitrary external editors. Generic editing, configuration history, launch, and using configuration to execute asset operations remain future work. [ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md) records these decisions. See the [implemented scope](002-WORKSPACE-EXPERIMENT.md) and [recommendations](roadmap/002-WORKSPACE-CONFIGURATION.md).

## Game discovery and admission

`@konogame/game` is a core Module at shared version `0.1.0-alpha.0`. `game.discover` resolves an Adapter for `game.discovery/discover` requiring `discovery.local`, `discovery.scoped`, and the capability `discovery.source.${kind}` taken from the configured source token. Game keeps candidates, evidence, diagnostics, preview, and admission, and treats discovery scope as a bounded opaque object. The filesystem extension owns directory entry kinds, directory scope validation, and the shared discovery filesystem service. `filesystem.game-discovery` handles standalone directories; independently versioned `konogame.steam@0.1.0-alpha.0` provides `steam.game-discovery` and reads that filesystem service through its declared dependency, with `steam = "generic"` software compatibility based on synthetic fixtures. Application composition uses owner Context.Service tags and native Effect Layers; service construction does not replace capability negotiation.

Application services require an existing configured Host/source, explicit scope, read-only preview and selected confirmation. Host roots, source declarations and library references do not expand scanning. Reliable Steam App ID may reuse Game identity; names cannot merge entities. Directory candidates remain weak observations, and new installations have empty `launchEntries`. Confirmation strictly validates untrusted preview input, independently anchors root and rechecks revision, evidence and resolved Adapters. Digests detect changes rather than authenticate signatures; no TTL applies. A fresh duplicate preview may return unchanged, while replay of a consumed preview is stale.

`workspace.import` uses `workspace.configuration/import` with `configuration.import`; `workspace.recover-import` uses `recover-import` with `configuration.import-recovery`. TOML configuration import shares the rename writer lock, preserves existing record bytes/layout and retains a journal for explicit forward recovery after partial creation. Joint writes are not atomic across files; external changes stop recovery. No general transaction engine, automatic retry of old previews, network enrichment or launch is included. See [ADR 0004](adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md), the [experiment](002-WORKSPACE-EXPERIMENT.md) and [development guide](004-DEVELOPMENT.md) for precise boundaries and responsibility examples.

## Location behavior and persistence ownership

Workspace holds only the public serializable `LocationContract` value `{ type, schemaVersion, data }`. `ExtensionRegistry` registers stable type definitions with independent schema versions/ranges and portable JSON Schema; configured instances are not registry entries. `AdapterRegistry` registers descriptors and typed implementations, validating ownership, Port version, Operation, Capability and every supplied Location type/schema range. Compare must support both operands. `LocationBehaviorService` resolves an Adapter for each operation before implementation access; comparisons can be unknown/incomparable, and resolution can return a non-path typed resource. Inspection preserves original values and exposes validation, availability and Adapter Resolution Plans. Unknown types or unsupported schemas remain `unverified`/`unavailable`, readable and preserved, without being executed as valid resources.

Workspace owns the Feature declarations, configuration Port, UUID identity and filename codec. The bundled `konogame.workspace-toml` Extension supplies `workspace-toml.configuration` and releases independently. CLI and daemon select the configuration source before reading Workspace records. The TOML Adapter reads configuration independently of filesystem Location registration. Filesystem owns `fs.absolute`/`fs.relative` definitions and behavior plus native discovery I/O. Host roots are Adapter context; core does not interpret path semantics. Location schema `1.0.0`, Port `0.2.0` and independently versioned Extensions are distinct. Explicit Extension dependencies validate versions/cycles; reuse of filesystem services is permitted. Bundled/injected sources support lazy activation; explicit-root Node installed discovery is available, while marketplace/download and independent host isolation are not implemented.

Candidates and existing installations are compared through the Location Port, never path strings or JSON serialization. Fresh admission needs valid/comparable locations. Pending import recovery completes approved metadata from its journal and does not access Location resources or require their registration. Existing Node read/rename transport is retained in core; import I/O is injectable, without claiming every transport is abstracted. See [ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) and the practical [Location guide](005-LOCATION-AND-REGISTRIES.md).

## Services and Extension lifecycle

`@konogame/infrastructure` owns implementation registries, activation, lifecycle, Adapter resolution and Temporal/ID services without depending on business Modules or Extensions. Domain/application/implementation packages own their own Ports, tokens and provide functions; apps compose sources and parameters. One internal multi discovery-source flow registers manifests and contributed Adapter/Location declarations before loading implementation code. An internal commit synchronizes both registry indexes/snapshots before public state/results notification, with a shared catalogVersion; public streams do not drive synchronization.

`AdapterResolver` negotiates compatibility and lazily activates selected contributions/dependencies before implementation access. Explicit events are respected; inferred demand selects one compatible contribution. Each generation uses a native Layer/Scope with root override priority and declared active dependency contexts. prepare/prepared only registers the catalog; initialize/ready additionally handles startup. Private PubSub exposes read-only state/results Streams and snapshots; native Deferred/Fiber coordinate completion. `ExtensionModule.layer` supplies services and Effect `activate` stages implementations until success. [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) defines the Effect 4.0.6 contracts.

Missing/version/cycle dependency failures remain visible and blocked without disabling unrelated contributions. Activation is shared per generation and publishes implementations only after success. Added implementations need no root-preinstalled Extension services; active changes return `restart-service-required`, and inactive changes are allowed only without active dependents. Application Layers initialize before exposing services, daemon listens afterward, and Scope owns generation release. See [ADR 0006](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) and the [service/lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) for APIs and current loader limits.

## Entry points and builds

Node 26 ESM entry modules export functions and execute only under `import.meta.main`; imports do not start processes. Use `import.meta.dirname`/`import.meta.filename` rather than reconstructed paths. `apps/cli` and `apps/daemon` each merge owner Layers and select bundled filesystem/Steam plus explicitly configured installed sources. Workflows stay in the module that owns the capability. `packages/game` may depend on `packages/workspace`; `workspace` does not depend on `game`. Add `packages/layer-composition` only when several cross-feature combinations cannot live in an existing module. See [ADR 0009](adr/0009-APPLICATION-COMPOSITION.md) for the retired composition package and [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) for the current Effect rules. Each package builds separate JavaScript/declarations with tsdown without bundling, and exports `dist` artifacts. The dev-cli is a workspace under `scripts/dev-cli/src/main.ts`. Vitest supplies tests. Daily commands enter through `just` and forward to the owning tool: `just check` forwards to `pnpm check`, which runs Biome, build, typecheck, tests, docs, and release metadata checks. pnpm, Node, and future Cargo or uv commands remain available for their own scope and for agents.

The CLI uses Optique command parsers and clack TTY assistance. No-command menus and missing-argument prompts respect flags > environment > TTY. `--non-interactive`, `--interactive=false`, and `INTERACTIVE=false` disable prompting; JSON/non-TTY execution never prompts and cancellation does not write.

TypeScript projects share `tsconfig.base.json` and use per-workspace configurations with dependency references. The root solution references those projects plus separate tests and build-tooling projects. `customConditions: ["monorepo-tsc"]` selects source entries placed before `types`/`import` in workspace exports, so the editor resolves source without waiting for a package build. Execution imports continue to select `dist`. Test projects also enable the `test` condition, which resolves a source-only subpath that production projects leave unresolved. `just typecheck` forwards to `pnpm typecheck`, which uses `tsc --build`; its declaration maps and incremental outputs stay in ignored `dist-tsc/`, separate from tsdown artifacts. Root and workspace `tsconfig.json` files contain only references to role-specific `tsconfig.app.json`, `tsconfig.lib.json`, `tsconfig.tool.json`, and `tsconfig.test.json` projects as applicable. Each package has its own test project, which references production dependencies and is excluded from production builds. Vitest groups unit tests of one rule or service under `src/**/__tests__/`, complete user-workflow integration tests under workspace or repository `tests/integration/`, and executable workflow tests under workspace or repository `tests/e2e/`. Run one group with `just test --project unit`, `integration`, or `e2e`. Disposable test files use `temp/tests/` at the repository root or the owning workspace: the hierarchy is stable, and only the final entry is a random UUIDv7. See the [development guide](004-DEVELOPMENT.md).

## Integration map


- **Ludusavi**: future discovery/export/import Adapter for saves; it is not the storage layer.
- **Kopia**: future snapshot/blob infrastructure Adapter, potentially shared by Save and Patch Modules; versioning stays optional.
- **OpenDAL**: future storage/replication Adapter and configuration mapping for backends; core does not parse adapter-specific options.
- **Trilium**: future notes, guide, and achievement-log Module integration.
- **Syncthing / Rclone / RustFS**: transport or backend roles beneath replication/storage. Syncthing can synchronize filesystem replicas, Rclone can reach remote targets, and RustFS can supply an S3 endpoint. They are not Save Module APIs.

Earlier designs remain in the [historical archive](archive/README.md). Windows mounting, UI, launch orchestration, external process protocol, and persistence policy need separate decisions before implementation.

## Installed sources and load robustness

Core validates strict declarations before relationship checks/loaders, safely isolates malformed source items and preserves accepted catalogs on rejection. Stable source IDs and cancellable DiscoveryBatch results drive refresh deltas without deleting unseen old entries after incomplete scans. `packages/node-installed-extension-source` owns explicitly configured one-level installed scanning and data-only package metadata; core does not depend on it. CLI extension list/status/refresh only prepares the catalog; short-lived refresh is not persistent installation management. Phase deadlines and structured diagnostics bound asynchronous waiting and report incomplete cleanup, without isolation or force termination. Late catalog changes re-evaluate remembered events and the default last 256 distinct complete requests, without using request keys as resource identity. See [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) and the [VS Code/Theia comparison](007-EXTENSION-SYSTEM-COMPARISON.md).

## Workspace management and library queries

[ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md) adds strict initialize/edit/recovery Operations to the existing configuration Port. Domain edit planning computes one-record changes; application previews are read-only and carry raw revision, identity, intent/differences, read/apply resolved Adapters and digest. Apply independently checks the root and rebuilds the review. The TOML Extension owns exclusive initialization and journaled AST edits with shared writer coordination; this does not promise multi-file atomicity or external-editor compare-and-swap. Metadata edits/recovery preserve Location and do not execute resources. Library list/show joins identities and availability; explain exposes seven layers, origins/clears and Feature compatibility without executing asset operations. Exact CLI, replacement semantics and limits are in the [management guide](008-WORKSPACE-MANAGEMENT.md). Schema 4 and release versions are unchanged.

## Test boundaries and task graph

Tests are classified by the boundary they verify: isolated rules/services are unit tests; composed services, injected CLI dispatch/prompts and process/module contracts are integration tests; built program entries with normal composition and real disposable Workspace workflows are end-to-end tests. A child process alone does not make a test end-to-end. `just test --project unit`, `integration`, or `e2e` selects a Vitest project. Turborepo schedules required `dist` builds for tests through pnpm; build artifacts use a local cache, while tests always execute. Direct `just cli`, `just daemon` and `just dev-cli` still require an explicit build. See [ADR 0010](adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md) and the [development guide](004-DEVELOPMENT.md).

## Effect contracts and scoped execution

Side-effecting Ports return `Effect<Success, Error, Requirements>` with owner tagged errors; pure rules and schemas remain pure. Composition returns native Layers, and Scope owns streams, handles, listeners and activation generations. Native Fiber/Deferred/Clock replace custom scheduling and cancellation. Promise/run bridging is confined to real process/framework/test boundaries. Cleanup budgets are cooperative, not force termination; recovery journals and structured stderr logging retain actionable evidence when interruption cannot carry an additional finalizer failure. Declaration protocol `0.2.0` requires `>=0.2.0 <0.3.0`; Schema 4 and release versions remain unchanged. See [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) and the [lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md).

[English](001-ARCHITECTURE.md) | [中文](../zh/001-ARCHITECTURE.md)
