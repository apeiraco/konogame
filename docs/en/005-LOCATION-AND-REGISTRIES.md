# 05 Location and registries

This guide describes Workspace schema `workspace.experimental.4`. [ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) records ownership and compatibility decisions; the [experiment](002-WORKSPACE-EXPERIMENT.md) describes CLI review and recovery.

## Write an installation Location

This complete synthetic installation record requires matching Game/Host IDs, an existing configured `loose` source, and a record filename/layout from the experiment guide. For this relative location, its Host supplies `platform = "windows"` and `[roots] games = "C:/Synthetic/Games"`.

```toml
schemaVersion = "workspace.experimental.4"
kind = "installation"
id = "01900000-0000-7000-8000-000000000003"
uniformName = "Sample Game"
gameId = "01900000-0000-7000-8000-000000000001"
hostId = "01900000-0000-7000-8000-000000000002"
sourceId = "loose"
launchEntries = []

[location]
type = "fs.relative"
schemaVersion = "1.0.0"

[location.data]
rootKey = "games"
path = "Sample Game"

[settings]
```

For an absolute location, replace those location tables with:

```toml
[location]
type = "fs.absolute"
schemaVersion = "1.0.0"

[location.data]
path = "C:/Synthetic/Games/Sample Game"
```

The filesystem Adapter interprets paths and checks containment. A successful resolution is a `filesystem.path` resource reference; it does not prove that a directory exists. Context roots do not authorize discovery scanning.

## Preserve an unfamiliar value

The same installation can instead contain this synthetic unknown type:

```toml
[location]
type = "example.catalog"
schemaVersion = "2.0.0"

[location.data]
catalog = "sample"
key = "game-42"
```

Core can read this envelope and preserve its data without a registered type. Inspection retains the original Location and reports `validation.status = "unverified"` and `availability.status = "unavailable"`, with reasons and a Binding Plan. A known type with an unsupported schema version behaves the same way. Invalid envelopes, null/date values and unsafe numbers are rejected. Metadata inspection/rename and recovery of an approved import journal do not require Location execution; fresh admission and resource operations require compatible validation/comparison or resolution.

## Register and use behavior

The [contracts](../../packages/contracts/src/location.ts) define the envelope, portable type definition, optional Location Port methods and typed resource result. [Core registries](../../packages/infrastructure/src/registry.ts) validate declarations and expose catalog and activation states; [binding](../../packages/infrastructure/src/binding.ts) activates compatible implementations on demand. [Filesystem Location values](../../extensions/filesystem/src/location-values.ts), [manifest](../../extensions/filesystem/src/manifest.ts) and [behavior](../../extensions/filesystem/src/location.ts) separate definitions, declarations and code. [LocationBehaviorService](../../packages/infrastructure/src/location.ts) binds each operation; [admission](../../packages/game/src/admission.ts) uses it for admission and duplicate checks.

Register a Contribution containing a manifest and lazy loader through package providers or a discovery source. The manifest declares stable Location IDs, independent schema versions/ranges and `dataSchema` under `contributes.locations`, and compatible Adapter descriptors under `contributes.adapters`. `dataSchema` accepts Standard Schema or JSON Schema at the boundary and is stored/transmitted as JSON Schema, evaluated with arktype and converted with `@ark/json-schema`/`toJsonSchema`. In-process Standard Schema is an explicit executable boundary whose schema hooks may run; rejecting getters on ordinary declarations does not make schema conversion passive or sandboxed. External installed manifests are pure JSON. Activation calls `context.registerAdapter(id, locationImplementation, implementation)`; core publishes staged implementations only after success. Definitions are not configured instances. `checkLocation` checks registered type/range support, not actual data validation. Dependency problems remain catalog diagnostics with blocked activation. See the [service/lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) for provider ownership, child scopes and lifetime management.

Use `LocationBehaviorService.validate`, `.compare` or `.resolve` with Host context as needed. Each operation binds Contract, Operation, Capability and schema support before retrieving the typed implementation. Compare binds both operands; `unknown`/`incomparable` cannot be treated as `different`. Resolve may return a non-path resource. Never deduplicate using path strings or JSON serialization. Issued bindings are issued objects, so a saved plan cannot be replayed as an execution handle.

| Version | Current meaning |
| --- | --- |
| `workspace.experimental.4` | Workspace record envelope; old schema 3 is not read or migrated. |
| Location schema `1.0.0` | Shape of filesystem Location data; filesystem currently declares exact range `1.0.0`. |
| Contract `0.2.0` | Port protocol; compatibility is negotiated separately. |
| Core `0.1.0-alpha.0` | Shared core package release, including `@konogame/workspace-configuration`. |
| Extension `0.1.0-alpha.0` | Current independently versioned filesystem/Steam releases. |

The [core configuration Adapter](../../packages/workspace-configuration/src/index.ts) belongs to `konogame.workspace` Module, while filesystem behavior belongs to its Extension. Configuration reading works without Location registration. Existing Node read/rename transport is retained, and [import I/O](../../packages/workspace-configuration/src/workspace-import.ts) is injectable; a universal transport abstraction, marketplace/download and independent host isolation are not implemented; explicit-root Node installed discovery is now available. Bundled/injected sources support lazy activation as described in [ADR 0006](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md).

Catalog changes now re-evaluate late Location definitions and distinct complete binding requests. This replay bookkeeping does not compare resources; Location equality still uses the bound compare Port on both operands. Strict declaration validation and internal commit keep Extension/Adapter snapshots consistent before public notification. Installed Location Extensions can be declared through data-only packages; catalog inspection does not import them. See [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) and the [comparison report](007-EXTENSION-SYSTEM-COMPARISON.md).

[English](005-LOCATION-AND-REGISTRIES.md) | [中文](../zh/005-LOCATION-AND-REGISTRIES.md)
