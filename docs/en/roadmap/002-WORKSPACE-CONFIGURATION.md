# Workspace configuration and version management

Status: partially implemented; decisions accepted in [ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md), updated 2026-10-17. TOML schema 4, inspection, dedicated rename and bounded discovery admission are the [current experiment](../002-WORKSPACE-EXPERIMENT.md). Generic editing, history Adapters, and launch remain future work.

## Accepted baseline

Human management configuration uses TOML 1.0; machine JSON, JSON Schema, and Artifact manifests stay JSON. A single arktype model defines strict records, with only the common JSON/TOML value subset and no null, dates/times, non-finite numbers, or unsafe integers. Exported schema documents use JSON Schema. Games' own INI/JSON/binary settings keep their native semantics through domain Adapters; exporting them produces an Artifact rather than converting all game settings to management TOML.

Workspace, Game, Host, Installation, and new Artifact IDs use lowercase UUIDv7. Game is a user-curated portable library identity; Installation is a local instance linked by `gameId` and `hostId`. A second installation has its own ID. Edition/title similarities and external references are evidence for review, not automatic identity merges. External references remain `{ authority, kind, key }` with structured string keys. The experiment accepts breaking changes, reports incompatible records, and preserves user data; it does not add migrations or legacy readers.

Game/Host/Installation store original `uniformName`. UUID alone identifies records. The `unicode-fs-v1` filename codec preserves Unicode/case, applies NFC, percent-encodes forbidden characters, controls, `%`, and trailing spaces/periods, and rejects components exceeding 255 UTF-8 bytes or UTF-16 units without truncation. Flat `<uuid>-<name>.toml` and directory `<uuid>-<name>/<kind>.toml` layouts are equal. Duplicate UUIDs fail; name suffix mismatches are diagnostic. `workspace.toml` is fixed. Host companion directories hold installations even when the Host record is flat.

Workspace stores Location as the serializable value object `{ type, schemaVersion, data }`. Core validates the generic envelope and common JSON/TOML subset, without interpreting filesystem paths. Host `roots` is context for relevant Adapters; source declarations retain `id`, `kind` and `status` but do not define scan scopes. The filesystem Extension defines `fs.absolute` and `fs.relative` at Location schema `1.0.0`, including Windows case rules and relative-root containment. Unknown types or unsupported schema versions remain readable and preserved, reported as `unverified`/`unavailable`. See the [Location guide](../005-LOCATION-AND-REGISTRIES.md) for TOML examples and registry use.

Seven setting layers remain built-in → Workspace → Game → Host → Host/Game → Installation → invocation. Omission inherits, arrays replace, and options replace per Adapter. `settings.clear` removes launch selection or listed Feature/Adapter map keys; same-layer set/clear conflicts fail. History mode is `disabled` or `adapter` with required `adapterId`, outside that chain. Bootstrap root and configuration Adapter selection come from the caller before records load.

## Current write unit and next edits

`workspace.rename` uses the existing `workspace.configuration` Port's `rename` Operation with Capability `configuration.rename`. It preserves UUID/references, comments, unaffected original TOML, and layout while changing `uniformName` and filesystem names. Host rename also moves its companion installation container. It is a dedicated workflow with a writer lock, expected revision, base hashes, temporary content, and recovery information. Destination conflicts never overwrite. Failed rollback requires recovery; retry is restricted to the same entity and target. External-editor races remain a documented limit, and history is independent.

Broader edits should add explicit validation and semantic previews using the same application boundary. Invalid external edits block writes; a changed base revision requires recomputing the diff and reviewing conflicts. Do not generalize rename into an unrestricted multi-file transaction engine. Discovery admission now uses a separate additive `import` Operation and explicit `recover-import` Operation. A shared writer lock, hashes and journal support forward completion of pending Game/Installation creation; cross-file writes are not atomic and external changes stop recovery. Existing Host/source bytes remain intact. See [ADR 0004](../adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md). Credentials should eventually use references through a credential Adapter; neither raw secrets nor progress belong in portable records.

Keep `.konogame/workspace.toml` and `games/` portable. Treat `local/`, cache, and recovery data as local and excluded from ordinary version control by default. These exclusions are not backups; explicit local record export/backup remains to be designed. Binary assets stay outside the configuration tree. A rebuildable index may later use a database without becoming the source of truth. A daemon is optional for local operations.

## Independent versions and optional history

| Version | Meaning |
| --- | --- |
| Schema marker | Current accepted experimental shape, without migration guarantees. |
| Configuration revision | Observed management configuration paths and raw bytes, distinct from an atomic snapshot. |
| Asset version/snapshot | Stored save, patch, or other asset content. |
| Contract/Extension version | Compatibility of operations and their implementations. |

Filesystem configuration works without Git. A Git Extension remains the first proposed configuration-history experiment. The sketched `ConfigurationHistoryPort` has `list`, `read`, `findOperation`, and `record`; no history Adapter is shipped. `workspace.history` resolves `list` with `history.versioned`. Recording should use operation IDs, expected history head, per-path prior hashes, and explicit known/unknown failures. Reusing an operation ID with different data must fail.

Initial history scope should include only fixed `workspace.toml` and current Game record layouts, including explicit moves/deletions; validate the scope in both application and Adapter. Exclude local records, credentials, assets, links, and arbitrary repository files. A read history result is untrusted current-schema input, never a direct instruction to replace working files. Use an independent history ref/index so the user's branch, index, staged files, and unrelated work remain intact. Test in a disposable repository before live use. Export/sync requires a separate policy.

Configuration writes and history recording have separate outcomes. Report a successful write plus recording failure and retain its operation identity for repair. Restore reads history, validates a current-schema change, previews/applies it through the application, then records a new revision. It does not rewind shared history or apply assets. Restoring desired settings does not undo a patch, restore a save, or change a running game.

## Next delivery and acceptance

The current slice covers synthetic Steam/standalone and multi-installation admission cases. Initialization, Host/source maintenance and limited reviewed edits are implemented in ADR 0008; additional intents need dedicated validation/recovery boundaries. Investigate launcher overlaps and managed-launch semantics through bounded, authorized observations. Keep all real paths, account identifiers, and inventories private. Coordinate with the [discovery](003-GAME-DISCOVERY.md) and [frontend](004-FRONTEND-EXPERIENCE.md) proposals.

- Inspect and rename work without Git, history, or a daemon.
- Both layouts retain UUID identity and comments through rename; collisions and stale revisions preserve user changes.
- Portable configuration moves between Hosts without conflating local roots or installations.
- Missing references, invalid values, incompatible Adapters, and recovery-required results remain visible.
- Future restore and broader edits use reviewed application workflows and reports partial effects.
- Historical schemas are reported rather than migrated implicitly; opaque options are not assumed execution-valid.

## Location boundary update

[ADR 0005](../adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) assigns TOML, metadata layouts and read/rename/import/recovery to the Module-owned core configuration Adapter. Future editing must preserve unknown Location values and allow metadata operations without Location registration; resource execution still needs compatible behavior. Approved journal recovery remains metadata-only, distinct from fresh admission. See the [Location guide](../005-LOCATION-AND-REGISTRIES.md).

## Lifecycle boundary

Configuration providers and I/O belong to their implementation package, while activation/lifecycle belongs to core; [ADR 0006](../adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) defines the boundary. Future editing/history Adapters must publish implementations through scoped activation and dispose their subscriptions/resources, while preserving schema 4 and existing journal semantics.

## Discovery and robustness follow-up

Future global/Workspace Extension enablement must define persistence and precedence without silently changing schema 4 or approved recovery. Current refresh is live catalog management; it is not a persisted Workspace preference. See [ADR 0007](../adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) and the [source comparison](../007-EXTENSION-SYSTEM-COMPARISON.md) for evidence and implementation triggers.

## Workspace management increment

[ADR 0008](../adr/0008-WORKSPACE-MANAGEMENT.md) implements existing-root initialization, Host/source/root maintenance, reviewed metadata/settings replacement and library list/show/explain. See the [management guide](../008-WORKSPACE-MANAGEMENT.md) for the finite supported intents and targeted recovery. These management operations do not grant discovery scope or mutate game resources. Next work remains asset backup/restore, optional configuration history, broader launcher integrations and UI; arbitrary editing/deletion and launch need separate contracts.

[English](002-WORKSPACE-CONFIGURATION.md) | [中文](../../zh/roadmap/002-WORKSPACE-CONFIGURATION.md)
