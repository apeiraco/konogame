# 02 Local Workspace experiment

Status: TOML schema 3, inspection, and dedicated entity rename slice, 2026-10-17. Decisions are recorded in [ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md); remaining work is in the [Workspace roadmap](roadmap/002-WORKSPACE-CONFIGURATION.md). The experiment allows breaking changes without historical migration or compatibility readers.

## Runnable scope

The Workspace Module resolves inspection and rename through the same Binding Plan flow as Save. It validates strict records, UUID/path relationships, explicit Host/Installation selection, effective settings with provenance, filename diagnostics, and content observation revisions. Rename updates an entity's original `uniformName` and filesystem name while retaining comments, layout, UUIDs, and references.

There is no generic configuration editor, history implementation, automated launcher discovery, game launch, asset binding from these records, or daemon Workspace endpoint. Source declarations and Adapter preferences express intent, not working integrations. `save store` still uses its own storage configuration.

## Run from the repository

```sh
just build
just cli features
just cli plan workspace.inspect
just cli plan workspace.rename
just cli workspace schema
just cli workspace inspect <workspace-root>
just cli workspace inspect <workspace-root> <host-id> <installation-id>
just cli workspace inspect <workspace-root> --adapter filesystem.workspace-configuration
just cli workspace rename <workspace-root> <record-id> <uniform-name>
just cli workspace inspect <workspace-root> --json --non-interactive
```

`just build` forwards to `pnpm build`. `just cli` runs the built Node CLI and forwards arguments as native argv. `pnpm build` and `pnpm cli` remain available for that scope and for agents.

The root is explicit; relative paths resolve from the process working directory. A user-selected root projection is allowed, but links inside the configuration tree are rejected. Do not infer the Workspace from the application checkout. Public examples use synthetic data; local inspection output may contain private paths.

The CLI uses oclif explicit commands and clack TTY prompts. Running without a command opens a menu; missing arguments can be requested. Flags override `INTERACTIVE`, which overrides TTY detection. `--non-interactive`, `--interactive=false`, and `INTERACTIVE=false` disable prompting. JSON/non-TTY execution never prompts; missing required values fail clearly. Cancelling a prompt does not write.

## Format and records

Human configuration is UTF-8 TOML 1.0; machine output, JSON Schema, and Artifact manifests remain JSON. Every record has `schemaVersion = "workspace.experimental.3"`, a lowercase UUIDv7 `id`, and `kind`. The Zod model is the source for runtime validation, types, and JSON Schema. Reject unknown fields, old markers, null, date/time values, non-finite numbers, and unsafe integers. Adapter option objects remain opaque until their Extension validates them for execution.

| Kind | Fields beyond the common envelope | Paths under `.konogame/` |
| --- | --- | --- |
| `workspace` | `name`, `defaults`, `history` | `workspace.toml` |
| `game` | `uniformName`, `title`, optional `edition`, `externalRefs`, `settings` | `games/<id>-<name>.toml` or `games/<id>-<name>/game.toml` |
| `host` | `uniformName`, `label`, `platform`, `roots`, `defaults`, `gameOverrides`, `sources` | `local/<id>-<name>.toml` or `local/<id>-<name>/host.toml` |
| `installation` | `uniformName`, `gameId`, `hostId`, `sourceId`, `location`, `launchEntries`, `settings` | `local/<host-id>-<name>/installations/<id>-<name>.toml` or `<id>-<name>/installation.toml` within the same installations directory |

Both layouts have equal meaning. A flat Host may own the same companion directory for installations. UUID is the sole identity: duplicate UUIDs are errors, and all relationships use IDs. `uniformName` retains original text. The filesystem suffix uses NFC and `unicode-fs-v1`: preserve Unicode/case, encode forbidden characters, `%`, controls, and trailing spaces/periods as uppercase UTF-8 `%HH`. No transliteration or lowercasing occurs. Reject components over 255 UTF-8 bytes or 255 UTF-16 units without truncation. A suffix mismatch is diagnostic rather than a second identity.

History is explicitly `{ mode = "disabled" }` or `{ mode = "adapter", adapterId = "..." }`. No history Adapter is shipped. A named unavailable/incompatible/inactive Adapter is reported through the shared resolver. Bootstrap root and optional `--adapter` are caller inputs; loaded configuration cannot select how it loads itself.

Host `roots` is a user-defined map of keys to absolute paths for that Host platform. Source declarations contain `id`, `kind`, and `status` (`planned` or `configured`), with no source roots. They do not establish scan scopes. Installation `location.kind` is `fs.absolute` with absolute `path`, `fs.relative` with `rootKey` plus relative `path`, or `managed` with `{ authority, kind, key }` reference. Relative paths must stay inside the referenced Host root. No built-in drive/store-library hierarchy is assumed. Paths are not probed for existence and launch entries are not executed.

Configuration files are limited to 1 MiB each. Small configuration metadata is read in memory; game Artifacts keep their streamed multi-file contract. Revisions hash sorted configuration paths and raw bytes, including local records; whitespace edits change a revision. A read revision is an observation token, not a history ID or an atomic snapshot.

## Effective settings

Order: built-in → Workspace → Game → Host → Host/Game → Installation → invocation. An omitted field inherits; arrays replace; `preferredAdapters` merges by Feature ID; `adapterOptions` replaces each Adapter's whole object. No deep merge, environment expansion, or templates run.

```toml
[settings.clear]
launchEntry = true
preferredAdapters = ["save.store"]
adapterOptions = ["filesystem.save-store"]
```

The same layer cannot set and clear the same scalar/map key. `arguments = []` clears the argument array. Inspection reports the winning origin and may use JSON null for an explicitly cleared effective value; records do not contain null. Invocation overrides remain an application API/test surface. Final launch semantics are future work.

## Rename and recovery limits

`workspace.rename` resolves `workspace.configuration/rename` with `configuration.rename`. It changes Game/Host/Installation `uniformName` and their file/directory names; title/label and references are independent. Host companion containers move together. The existing flat/directory choice, unaffected TOML text, and comments are preserved.

The application supplies an expected revision and operation identity. The filesystem Adapter coordinates application writers with a lock, rechecks revisions/hashes, stages temporary content, and retains recovery data. Conflicts do not overwrite destinations. Recovery/retry applies only to the same entity and target. Failed rollback is reported as requiring recovery. Arbitrary external editors do not share this lock, so the workflow does not promise atomic compare-and-swap against them. Recovery data is neither history nor a general transaction system. Optional history cannot disable basic inspection or rename.

Synthetic fixtures cover schema rejection, both layouts, Unicode filename encoding and limits, roots/locations, layered clears, stale revisions, collisions, comment preservation, and recovery paths. Private observations, account identifiers, real paths, and game inventories stay outside public fixtures and documentation. Broader editing, discovery admission, and optional Git history are [future increments](roadmap/001-INITIAL-ITERATIONS.md).

[English](002-WORKSPACE-EXPERIMENT.md) | [中文](../zh/002-WORKSPACE-EXPERIMENT.md)
