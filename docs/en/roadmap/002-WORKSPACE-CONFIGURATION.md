# Workspace configuration and version management

See the [experiment guide](../002-WORKSPACE-EXPERIMENT.md) for TOML layouts, identity and overrides, and the [management guide](../008-WORKSPACE-MANAGEMENT.md) for supported edits and recovery.

## Independent versions and optional history

| Version | Meaning |
| --- | --- |
| Schema marker | Current accepted experimental shape, without migration guarantees. |
| Configuration revision | Observed management configuration paths and raw bytes, distinct from an atomic snapshot. |
| Asset version/snapshot | Stored save, patch, or other asset content. |
| Port/Extension version | Compatibility of operations and their implementations. |

Filesystem configuration works without Git. A Git Extension remains the first proposed configuration-history experiment. The sketched `ConfigurationHistoryPort` has `list`, `read`, `findOperation`, and `record`; no history Adapter is shipped. `workspace.history` resolves `list` with `history.versioned`. Recording should use operation IDs, expected history head, per-path prior hashes, and explicit known/unknown failures. Reusing an operation ID with different data must fail.

Initial history scope should include only fixed `workspace.toml` and current Game record layouts, including explicit moves/deletions; validate the scope in both application and Adapter. Exclude local records, credentials, assets, links, and arbitrary repository files. A read history result is untrusted current-schema input, never a direct instruction to replace working files. Use an independent history ref/index so the user's branch, index, staged files, and unrelated work remain intact. Test in a disposable repository before live use. Export/sync requires a separate policy.

Configuration writes and history recording have separate outcomes. Report a successful write plus recording failure and retain its operation identity for repair. Restore reads history, validates a current-schema change, previews/applies it through the application, then records a new revision. It does not rewind shared history or apply assets. Restoring desired settings does not undo a patch, restore a save, or change a running game.

## Experiment acceptance and open questions

Exercise path restrictions, duplicate operation IDs, stale heads and repair after a successful write followed by a recording failure in a disposable repository. Restore must preview path and content changes and require confirmation before writing.

Explicit backup of local records, credential references and the scope and precedence of Extension enablement remain open. Each additional edit intent needs defined writable fields, conflict checks and targeted recovery.

[English](002-WORKSPACE-CONFIGURATION.md) | [中文](../../zh/roadmap/002-WORKSPACE-CONFIGURATION.md)
