# 08 Workspace management and library maintenance

Status: current local prototype, 2026-10-18. [ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md) records the decision. The [experiment guide](002-WORKSPACE-EXPERIMENT.md) covers record layouts and discovery/admission. Commands below use synthetic paths and IDs; build first with `just build`.

## Initialize an existing directory

Select a directory that already exists. Konogame does not recursively create a user directory or adopt an existing `.konogame`, even if that configuration directory is empty.

```sh
just cli workspace init C:/Synthetic/Library --name "Sample Library" --host-name "Sample PC" --platform windows --yes --json
```

`--platform` accepts `windows`, `linux` or `macos`; optional `--host-label` sets the initial display label, defaulting to `--host-name`. `--adapter` selects the configuration Adapter; `--operation-id` can supply a stable UUIDv7 for recovery. Initialization creates distinct Workspace/Host UUIDv7 identities, empty defaults/roots/sources/Host overrides, and disabled history. Git and a daemon are not required.

The chosen root contains `.konogame/workspace.toml`, a directory-layout Host at `.konogame/local/<host-key>/host.toml`, and `.konogame/.gitignore` excluding `/local/`, `/cache/`, `/recovery/`. The user root's `.gitignore` is not changed. Source declarations and game records are added through their separate workflows.

Initialization exclusively reserves `.konogame` with mkdir, stages its bounded file set and publishes each file without replacing an existing destination, with `workspace.toml` last. This is not atomic directory publication or a multi-file transaction. On `recovery-required`, retain the operation ID and use:

```sh
just cli workspace recover-initialize C:/Synthetic/Library <operation-id> --yes --json
```

Recovery only completes this approved initialization from its journal/receipt and verifies existing content. A pre-existing/incomplete directory without a valid journal requires manual inspection; recovery does not invent a new operation or overwrite conflicting bytes.

## Review one change before applying it

Host addition defaults to a read-only preview. New Hosts use directory layout. Explicit `--apply --yes` applies the rebuilt preview in the same invocation.

```sh
just cli workspace host add C:/Synthetic/Library "Second PC" --platform windows --json > C:/Synthetic/host-preview.json
just cli workspace edit apply C:/Synthetic/Library C:/Synthetic/host-preview.json --yes --json
```

For existing records, choose one change category:

```sh
just cli workspace edit preview C:/Synthetic/Library --record-id <game-id> --title "Sample Game" --json > C:/Synthetic/edit-preview.json
just cli workspace edit apply C:/Synthetic/Library C:/Synthetic/edit-preview.json --yes --json
```

CLI `--title` alone preserves the current edition; `--edition` changes it and `--unset-edition` explicitly removes it. Workspace display name uses `--name`; Host display label uses `--label`. These do not change `uniformName`; use the existing `workspace rename` workflow for filenames and uniform names.

The strict `workspace-edit-preview.1` contains root, Workspace ID, expected raw revision, operation ID, configuration Adapter ID, change, semantic differences, read/apply Binding Plans and digest. Preview reads and computes without changing configuration. A read-only configuration Adapter may preview while reporting apply unavailable. Apply strictly parses the preview, independently checks the caller-selected root, rereads the Workspace and rebuilds the full review before writing. Changed bytes/revision/bindings or a modified preview require a fresh review. The digest detects changes; it is not an authorization signature. Even an unchanged apply requires a fresh preview and explicit confirmation.

## Supported intents

Each edit affects one record through a strict intent, not arbitrary TOML paths or submitted replacement records. UUIDs, `uniformName`, relationships, Location, external references and launch entries are outside editable metadata projections.

| Intent | Supported change |
| --- | --- |
| `metadata.replace` | Workspace name; Game title and optional edition; Host label. The Game projection requires title; omitting edition in the raw intent removes it. |
| `settings.replace` | A complete persistent Workspace/Game/Host/Installation layer, or a Host/Game override in the Host record. |
| `host.create` | A validated new Host with its own UUID. |
| `host.roots.replace` | Replace one Host's roots context. |
| `host.sources.replace` | Replace one Host's source declarations. |

`--change-file` accepts a strict JSON intent and is mutually exclusive with convenience change flags. For example, a source declaration file can contain:

```json
{
  "kind": "host.sources.replace",
  "hostId": "01900000-0000-7000-8000-000000000002",
  "sources": [
    { "id": "loose", "kind": "standalone", "status": "configured" }
  ]
}
```

```sh
just cli workspace edit preview C:/Synthetic/Library --change-file C:/Synthetic/source-change.json --json
```

For convenience, `--host-id` with repeatable `--root-set alias=value`/`--root-remove alias`, or repeatable `--source-set id:kind:status`/`--source-remove id`, starts from current values and preserves other keys/declarations. A referenced source cannot be removed or have its kind changed. Setting its status back to `planned` is allowed, retains references, and remains visible in library queries. Roots are Adapter context and do not grant discovery scope. Source kind is not an Adapter ID.

## Replace a settings layer deliberately

Choose `--kind workspace|game|host|host-game|installation` and `--record-id`; Host/Game additionally requires `--game-id`. `--settings-json` replaces the entire chosen layer. The smaller `--arguments-json`, repeatable `--preferred-adapter Feature=Adapter` and `--clear-preferred-adapter Feature` flags preserve other settings before producing a complete intent. Do not combine full replacement JSON with those smaller flags.

| Value in a replacement | Meaning |
| --- | --- |
| Omitted setting | Remove this layer's value and inherit from earlier layers. |
| `clear` | Explicitly clear the selected inherited scalar/map entry. Same-layer set/clear conflicts are invalid. |
| `arguments: []` | An explicit empty argument array. |
| Host/Game `settings: {}` | Remove that override and restore inheritance. |

Built-in and caller override layers are not persisted. Arrays replace; Adapter options replace as a whole per Adapter. Ordinary settings validation does not prove opaque Adapter options are valid for execution. Configuration values reject null, dates/times, non-finite numbers and unsafe integers.

## Inspect the library and explain settings

```sh
just cli game list C:/Synthetic/Library --json
just cli game list C:/Synthetic/Library --host-id <host-id> --source-id loose --json
just cli game show C:/Synthetic/Library <game-id> --json
just cli workspace explain C:/Synthetic/Library --installation-id <installation-id> --feature save.store --json
```

List/show joins Games with installations, Host/source declarations, original Location and validation/availability. A source filter requires a Host; unknown Location types remain readable with explicit unavailable status. This does not launch a game or certify resource existence. Explain returns the seven layers, effective values/origins, explicit clears and per-Feature binding availability/reasons. Installation-only explain selection derives its Host; explicitly contradictory selections are rejected, while the older inspect selection contract is unchanged. Location status is reported independently and is not attached as a constraint to generic Feature binding, so an unknown Location does not block Artifact storage or metadata editing. Selection also accepts `--game-id`/`--host-id`; `--overrides-json` supplies a non-persisted caller layer. `--feature` is repeatable, and `--adapter` selects configuration reading. Binding evaluation can activate compatible Extensions; it does not execute the selected asset operation.

## Persistence and recovery limits

Core configuration owns these algorithms through `workspace.configuration` Operations `initialize`, `recover-initialize`, `edit`, `recover-edit`, with respective Capabilities `configuration.initialize`, `configuration.initialize-recovery`, `configuration.edit`, `configuration.edit-recovery`. Existing read/rename/import/recovery remain distinct. Workspace review is in [management.ts](../../packages/workspace/src/management.ts); [domain edit planning](../../packages/workspace/src/index.ts) recomputes valid records; [persistence](../../packages/workspace-configuration/src/workspace-management.ts) and [TOML token edits](../../packages/workspace-configuration/src/toml-edit.ts) own I/O/text preservation.

Edit preserves untouched bytes/comments, newline style and existing flat/directory layout through AST token changes; removing affected table tokens retains standalone comments. Changed fields may receive new formatting. Records stay within 1 MiB UTF-8; management journals have a 16 MiB limit. An accepted unchanged result preserves record bytes but consumes the operation ID and may write a coordination receipt, prepare recovery directories and acquire/release the writer lock. Retrying the same request returns unchanged; reusing that operation ID with a different payload or revision conflicts. This is not a promise of zero filesystem writes. Same-parent short staging names support valid record filename components at the existing maximum length without relaxing the existing filename limit.

Initialization/edit share writer coordination with rename/import and block on pending operations. A targeted edit journal records intent, before/after content and original raw revision/hashes. Existing-record publication uses a single-file replacement after a final content check; new Host publication is exclusive. External editors do not share the lock, so the last-check/replacement race cannot be eliminated. External changes stop recovery instead of being overwritten.

```sh
just cli workspace edit recover C:/Synthetic/Library <operation-id> --yes --json
```

Recovery handles only already approved metadata, without executing Location resources or depending on history. It does not automatically retry stale previews or implement general rollback/transactions. JSON/non-TTY writes and recoveries require `--yes`; TTY confirmation can be cancelled without writing, and init cancellation occurs before service construction. Arbitrary editing, deletion, changing installation identity/Location, launch, Git history and asset backup/restore remain outside this slice. Workspace schema 4 and core/Extension versions are unchanged. Public examples/tests remain synthetic; private Workspace validation results belong only in redacted implementation reports after actual verification.

## Effect execution and interruption

Configuration Ports and I/O now return typed Effects under owner Layers; Scope owns writer locks/handles and only releases acquired resources. Preview remains read-only and apply/recovery retains the documented root/revision/evidence and approved-metadata checks. Interruption remains Interrupt; retain recovery material and inspect structured stderr logs for recovery-required failures. Minimal native publication can finish before interruption is observed. Cleanup budgets are cooperative, and Effect 4.0.6 nested bracket interruption can omit an additional finalizer failure from the outer Cause. See the [lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) and [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md). Schema 4 and release versions are unchanged.

[English](008-WORKSPACE-MANAGEMENT.md) | [中文](../zh/008-WORKSPACE-MANAGEMENT.md)
