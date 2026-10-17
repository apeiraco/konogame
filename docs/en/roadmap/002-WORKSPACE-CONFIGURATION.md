# Workspace configuration and version management

Status: partially implemented; decisions accepted in [ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md), updated 2026-10-17. TOML schema 3, inspection, and dedicated rename are the [current experiment](../002-WORKSPACE-EXPERIMENT.md). Generic editing, discovery admission, history Adapters, and launch remain future work.

## Accepted baseline

Human management configuration uses TOML 1.0; machine JSON, JSON Schema, and Artifact manifests stay JSON. A single Zod model defines strict records, with only the common JSON/TOML value subset and no null, dates/times, non-finite numbers, or unsafe integers. Games' own INI/JSON/binary settings keep their native semantics through domain Adapters; exporting them produces an Artifact rather than converting all game settings to management TOML.

Workspace, Game, Host, Installation, and new Artifact IDs use lowercase UUIDv7. Game is a user-curated portable library identity; Installation is a local instance linked by `gameId` and `hostId`. A second installation has its own ID. Edition/title similarities and external references are evidence for review, not automatic identity merges. External references remain `{ authority, kind, key }` with structured string keys. The experiment accepts breaking changes, reports incompatible records, and preserves user data; it does not add migrations or legacy readers.

Game/Host/Installation store original `uniformName`. UUID alone identifies records. The `unicode-fs-v1` filename codec preserves Unicode/case, applies NFC, percent-encodes forbidden characters, controls, `%`, and trailing spaces/periods, and rejects components exceeding 255 UTF-8 bytes or UTF-16 units without truncation. Flat `<uuid>-<name>.toml` and directory `<uuid>-<name>/<kind>.toml` layouts are equal. Duplicate UUIDs fail; name suffix mismatches are diagnostic. `workspace.toml` is fixed. Host companion directories hold installations even when the Host record is flat.

Host `roots` maps arbitrary keys to absolute local paths. Installation uses `fs.absolute`, `fs.relative` with `rootKey`/`path`, or `managed` with an external reference. Relative paths resolve only against their owning Host root and cannot escape it. Source declarations do not contain `roots`; future scan scopes are separate. There is no predefined launcher-library or drive hierarchy.

Seven setting layers remain built-in → Workspace → Game → Host → Host/Game → Installation → invocation. Omission inherits, arrays replace, and options replace per Adapter. `settings.clear` removes launch selection or listed Feature/Adapter map keys; same-layer set/clear conflicts fail. History mode is `disabled` or `adapter` with required `adapterId`, outside that chain. Bootstrap root and configuration Adapter selection come from the caller before records load.

## Current write unit and next edits

`workspace.rename` uses the existing `workspace.configuration` Port's `rename` Operation with Capability `configuration.rename`. It preserves UUID/references, comments, unaffected original TOML, and layout while changing `uniformName` and filesystem names. Host rename also moves its companion installation container. It is a dedicated workflow with a writer lock, expected revision, base hashes, temporary content, and recovery information. Destination conflicts never overwrite. Failed rollback requires recovery; retry is restricted to the same entity and target. External-editor races remain a documented limit, and history is independent.

Broader edits should add explicit validation and semantic previews using the same application boundary. Invalid external edits block writes; a changed base revision requires recomputing the diff and reviewing conflicts. Do not generalize rename into an unrestricted multi-file transaction engine. Discovery admission needs a separate explicit failure/recovery design for Game plus Installation creation. Credentials should eventually use references through a credential Adapter; neither raw secrets nor runtime progress belong in portable records.

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

Validate synthetic standalone-directory and multi-installation cases, then add broader previewed edits and discovery admission. Investigate launcher overlaps and managed-launch semantics through bounded, authorized observations. Keep all real paths, account identifiers, and inventories private. Coordinate with the [discovery](003-GAME-DISCOVERY.md) and [frontend](004-FRONTEND-EXPERIENCE.md) proposals.

- Inspect and rename work without Git, history, or a daemon.
- Both layouts retain UUID identity and comments through rename; collisions and stale revisions preserve user changes.
- Portable configuration moves between Hosts without conflating local roots or installations.
- Missing references, invalid values, incompatible Adapters, and recovery-required results remain visible.
- Future restore/admission uses reviewed application workflows and reports partial effects.
- Historical schemas are reported rather than migrated implicitly; opaque options are not assumed execution-valid.

[English](002-WORKSPACE-CONFIGURATION.md) | [中文](../../zh/roadmap/002-WORKSPACE-CONFIGURATION.md)
