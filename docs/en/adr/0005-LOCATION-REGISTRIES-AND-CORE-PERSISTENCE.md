# ADR 0005: Location registries and core Workspace persistence

> Protocol update: [ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) changes the current Contract protocol to `0.2.0` and range to `>=0.2.0 <0.3.0`. Original version examples below preserve the decision at its date; release/version ownership and Location/schema rules remain.

Status: accepted, 2026-10-17. Supersedes only ADR 0002's built-in Location variants and filesystem Extension ownership of Workspace persistence. Its TOML, identity, Unicode layouts, override and rename decisions continue to apply. Refines [ADR 0004](0004-LOCAL-DISCOVERY-AND-INJECTION.md).

Later refinement: [ADR 0006](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) moves registries into core, preserves dependency failures as catalog diagnostics/blocked activation, and replaces direct implementation registration with manifest discovery and scoped lazy activation. The Location envelope, versions, compatibility checks and core persistence ownership below remain effective; registry execution details below describe the earlier slice.

## Context

An installation may refer to a filesystem directory or a resource with no path. Workspace must preserve unfamiliar configuration without pretending that it is usable. Vendor behavior and Workspace metadata persistence need distinct ownership, while all execution still uses one binding flow.

## Decision

Workspace schema is `workspace.experimental.4`. Its only Location representation is the public, serializable value object `{ type, schemaVersion, data }`. The generic schema validates the envelope and JSON/TOML common value subset; it does not enumerate filesystem or managed kinds. No schema 3 reader, migration or private configuration rewrite is supplied. Unknown types and unsupported Location schema versions remain readable, displayable and preserved as supplied, with `unverified` validation and `unavailable` resolution. A malformed generic envelope remains an error.

`ExtensionRegistry` registers type definitions, not configured instances. Each definition declares a stable `type`, `schemaVersion`, compatible `schemaRange` and portable `dataSchema`. Registration accepts a Standard Schema or JSON Schema and stores the JSON Schema form, independent of schema-library objects. Type support alone does not validate data or authorize execution. Extension registration checks duplicate IDs/types, Contract compatibility, declared dependency versions and cycles. Extensions may reuse other Extensions' services; Steam may reuse filesystem services with an explicit validated dependency.

`AdapterRegistry` registers descriptors plus typed implementations. Compatibility includes owner, Contract range, Operation, required Capability and each Location's type/schema range. Compare requires support for both operands. Descriptors without active implementations cannot execute. Implementation access requires a binding actually issued by that registry; JSON plans describe decisions and are not execution handles. There is no additional Provider registry, dynamic installation/download mechanism or isolated Extension loader.

The `location.behavior` Port exposes optional `validate`, `compare` and `resolve` Operations with `location.validation`, `location.identity` and `location.resolve` Capabilities. Application `LocationBehaviorService` binds each requested Operation before implementation access. Comparison can return `equal`, `different`, `unknown` or `incomparable`; missing behavior cannot fabricate equality or difference. Resolution returns a typed resource reference or `unavailable`, without requiring a pathname. Core never compares path strings or JSON encodings to establish Location equality. Host roots are context for relevant Adapters; core does not interpret their filesystem semantics.

The filesystem Extension owns `fs.absolute` and `fs.relative`, their validation, comparison, resolution, and native discovery I/O. Its Location schema `1.0.0` is independent of Contract protocol `0.1.0` and Extension release `0.1.0-alpha.0`. Filesystem behavior handles Windows case rules and relative-root containment; resolving a path does not verify existence or launch a game. Other types require their own definitions and compatible behavior.

Core `@konogame/workspace-configuration` owns TOML encoding, metadata layout, UUID/name projections, read, rename, additive import and recovery algorithms. `core.workspace-configuration` belongs to Module `konogame.workspace` through `owner: { kind: "module", id: "konogame.workspace" }`; Extension Adapters use `owner: { kind: "extension", id: ... }`. This replaces `extensionId` on Adapter descriptors and bindings. The new core package shares core release `0.1.0-alpha.0`; Extensions remain independently versioned. No artificial core Extension is created. Configuration reads remain available without filesystem Location registration.

Existing Node read/rename transport moved with these algorithms. Import transport uses the injectable `WorkspaceImportFileSystem` boundary. This does not claim that every configuration transport has been abstracted. Rename and import retain shared writer coordination, revision/hash checks and their distinct rollback/forward recovery semantics.

## Admission and recovery

Candidates and installations share the same Location envelope. Application discovery, candidate-to-candidate checks, existing-installation checks and fresh admission use bound validation/comparison. Fresh admission requires valid and comparable locations; unavailable comparison remains explicit and cannot bypass duplicate/conflict checks. Inspection includes the original Location, validation, availability and Binding Plan, without requiring `resolvedPath`.

Pending import recovery completes previously approved configuration metadata from an existing journal/receipt. It does not access or execute Location resources and does not require filesystem Location registration. Existing journal/hash checks, shared lock, forward recovery, external-change failures and non-atomic cross-file creation remain unchanged. Recovery does not admit a fresh preview or become a general transaction engine.

## Consequences

Unfamiliar locations survive inspection and unrelated metadata operations, while resource operations report why they are unavailable. Persistence and behavior can evolve independently. Tests cover missing/incompatible definitions and implementations, both comparison operands, non-path resources, unknown retention and recovery without Location registration. See the [Location guide](../005-LOCATION-AND-REGISTRIES.md), [architecture](../001-ARCHITECTURE.md) and [development guide](../004-DEVELOPMENT.md).

[English](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) | [中文](../../zh/adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)
