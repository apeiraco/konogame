# 02 Local Workspace experiment

Status: TOML schema 4, initialization/reviewed editing, inspection/rename and local discovery/admission, 2026-10-18. Decisions are recorded in [ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md); remaining work is in the [Workspace roadmap](roadmap/002-WORKSPACE-CONFIGURATION.md). The experiment allows breaking changes without historical migration or compatibility readers.

## Runnable scope

The Workspace Module resolves inspection and rename through the same Binding Plan flow as Save. It validates strict records, UUID relationships, explicit Host/Installation selection, effective settings with provenance, filename diagnostics, and content observation revisions. Rename updates an entity's original `uniformName` and filesystem name while retaining comments, layout, UUIDs, and references.

There is no generic configuration editor, history implementation, game launch, asset binding from these records, or daemon Workspace endpoint. Configured Steam/standalone sources support the bounded workflow below; other source declarations and Adapter preferences do not imply working integrations. `save store` still uses its own storage configuration.

## Run from the repository

```sh
just build
just cli features
just cli plan workspace.inspect
just cli plan workspace.rename
just cli workspace schema
just cli workspace inspect <workspace-root>
just cli workspace inspect <workspace-root> <host-id> <installation-id>
just cli workspace inspect <workspace-root> --adapter core.workspace-configuration
just cli workspace rename <workspace-root> <record-id> <uniform-name>
just cli workspace inspect <workspace-root> --json --non-interactive
```

`just build` forwards to `pnpm build`. `just cli` runs the built Node CLI and forwards arguments as native argv. `pnpm build` and `pnpm cli` remain available for that scope and for agents.

The root is explicit; relative paths resolve from the process working directory. A user-selected root projection is allowed, but links inside the configuration tree are rejected. Do not infer the Workspace from the application checkout. Public examples use synthetic data; local inspection output may contain private paths.

The CLI uses Optique command parsers and clack TTY prompts. Running without a command opens a menu; missing arguments can be requested. Flags override `INTERACTIVE`, which overrides TTY detection. `--non-interactive`, `--interactive=false`, and `INTERACTIVE=false` disable prompting. JSON/non-TTY execution never prompts; missing required values fail clearly. Cancelling a prompt does not write.

## Format and records

Human configuration is UTF-8 TOML 1.0; machine output, JSON Schema, and Artifact manifests remain JSON. Every record has `schemaVersion = "workspace.experimental.4"`, a lowercase UUIDv7 `id`, and `kind`. The record schema and the exported JSON Schema are the same structural constraints. Configuration values are strings, booleans, numbers within the safe integer range, arrays, and objects. Reject unknown fields, old markers, null, date/time values, non-finite numbers, and unsafe integers. Setting and clearing the same settings key in one layer is an edit rule, not a second schema. Adapter history requires an adapter ID, and disabled history cannot declare one; that pairing is a record check, not a second schema. Adapter option objects remain opaque until their Extension validates them for execution.

| Kind | Fields beyond the common envelope | Paths under `.konogame/` |
| --- | --- | --- |
| `workspace` | `name`, `defaults`, `history` | `workspace.toml` |
| `game` | `uniformName`, `title`, optional `edition`, `externalRefs`, `settings` | `games/<id>-<name>.toml` or `games/<id>-<name>/game.toml` |
| `host` | `uniformName`, `label`, `platform`, `roots`, `defaults`, `gameOverrides`, `sources` | `local/<id>-<name>.toml` or `local/<id>-<name>/host.toml` |
| `installation` | `uniformName`, `gameId`, `hostId`, `sourceId`, `location`, `launchEntries`, `settings` | `local/<host-id>-<name>/installations/<id>-<name>.toml` or `<id>-<name>/installation.toml` within the same installations directory |

Both layouts have equal meaning. A flat Host may own the same companion directory for installations. UUID is the sole identity: duplicate UUIDs are errors, and all relationships use IDs. `uniformName` retains original text. The filesystem suffix uses NFC and `unicode-fs-v1`: preserve Unicode/case, encode forbidden characters, `%`, controls, and trailing spaces/periods as uppercase UTF-8 `%HH`. No transliteration or lowercasing occurs. Reject components over 255 UTF-8 bytes or 255 UTF-16 units without truncation. A suffix mismatch is diagnostic rather than a second identity.

History is explicitly `{ mode = "disabled" }` or `{ mode = "adapter", adapterId = "..." }`. No history Adapter is shipped. A named unavailable/incompatible/inactive Adapter is reported through the shared resolver. Bootstrap root and optional `--adapter` are caller inputs; loaded configuration cannot select how it loads itself.

Workspace stores Location as the serializable value object `{ type, schemaVersion, data }`. Core validates the generic envelope and common JSON/TOML subset, without interpreting filesystem paths. Host `roots` is context for relevant Adapters; source declarations retain `id`, `kind` and `status` but do not define scan scopes. The filesystem Extension defines `fs.absolute` and `fs.relative` at Location schema `1.0.0`, including Windows case rules and relative-root containment. Unknown types or unsupported schema versions remain readable and preserved, reported as `unverified`/`unavailable`. See the [Location guide](005-LOCATION-AND-REGISTRIES.md) for TOML examples and registry use.

Configuration records have a uniform 1 MiB UTF-8 byte limit on reads and writes; import and rename reject oversized content before publication, and recovery checks record content retained in journals against the same limit. Small configuration metadata is read in memory; game Artifacts keep their streamed multi-file contract. Revisions hash sorted configuration paths and raw bytes, including local records; whitespace edits change a revision. A read revision is an observation token, not a history ID or an atomic snapshot.

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

The application supplies an expected revision and operation identity. The core configuration Adapter coordinates application writers with a lock, rechecks revisions/hashes, stages temporary content, and retains recovery data. Conflicts do not overwrite destinations. Recovery/retry applies only to the same entity and target. Failed rollback is reported as requiring recovery. Arbitrary external editors do not share this lock, so the workflow does not promise atomic compare-and-swap against them. Recovery data is neither history nor a general transaction system. Optional history cannot disable basic inspection or rename.

Synthetic fixtures cover schema rejection, both layouts, Unicode filename encoding and limits, roots/locations, layered clears, stale revisions, collisions, comment preservation, and recovery paths. Private observations, account identifiers, real paths, and game inventories stay outside public fixtures and documentation. Broader editing and optional Git history are [future increments](roadmap/001-INITIAL-ITERATIONS.md).

## Local discovery and explicit admission

An existing Host must declare a source with `status = "configured"` and `kind = "steam"` or `"standalone"`. Discovery itself does not create Hosts/sources; the separate [management workflow](008-WORKSPACE-MANAGEMENT.md) now supports their reviewed creation/maintenance. `game.discover` resolves a discovery Adapter plus Workspace inspection; `workspace.import` and `workspace.recover-import` use `workspace.configuration` Operations `import`/`recover-import` with `configuration.import`/`configuration.import-recovery`. A read-only configuration Adapter can preview while reporting import unavailable in its Binding Plan.

```sh
just cli game discover /synthetic/workspace --host-id <host-id> --source-id loose --scope /synthetic/games --json > /synthetic/preview.json
just cli game import /synthetic/workspace /synthetic/preview.json --candidate <candidate-key> --yes --json
just cli workspace recover-import /synthetic/workspace <operation-id> --yes --json
```

Paths are synthetic; replace them with explicitly selected local directories. On Windows use absolute paths such as `C:/Synthetic/Games`. Save previews outside the observed directories: creating a JSON file inside a scanned directory changes its evidence and makes confirmation stale. Redirection saves JSON; discovery itself writes no Workspace records. JSON/non-TTY import and recovery require `--yes`; `--candidate` is repeatable and at least one selection is required. TTY mode can prompt and cancellation does not write. CLI previews are regular UTF-8 JSON files, limited to 8 MiB on import.

`--scope` is repeatable and explicitly provided. CLI resolves relative input from its working directory to an absolute Port scope. `--max-depth` defaults to 1 and accepts 0–16. For standalone discovery, 0 observes each selected directory itself; positive depths observe descendants, excluding the selected root. `--exclude` is a repeatable relative directory prefix using `/`, not a glob. Host roots and source declarations never authorize a scan.

Filesystem candidates are directory observations with basename titles and no portable external identity. Each eligible directory is only a candidate; confirmation records a user choice and does not automatically certify it as a game. No executable contents are inspected or run. Directory evidence includes the directory and immediate entries' metadata. Links/junctions and linked ancestors are rejected or diagnosed; unavailable paths remain diagnostic. Traversal is bounded to 10,000 visited directories and 4,096 entries per directory.

Steam scope selects each library/root or its `steamapps` directory explicitly. It reads selected `appmanifest_*.acf` and validates `common/<installdir>`; it does not recurse by `maxDepth`. `libraryfolders.vdf` supplies evidence and diagnostics about unselected libraries, never authorization to scan them. App ID must be a positive uint32 matching the filename; StateFlags must contain fully-installed bit 4, and the safe installation directory must exist without links/traversal. Manifests have a 1 MiB read limit and bounded entries/candidates. The data-only KeyValues subset accepts quoted/bare strings, brace objects, `//` comments and supported backslash escapes; directives, conditions, duplicate keys and unsupported escapes fail. This is synthetic-fixture validation of an experimental format Adapter, not all-version Steam support. [ADR 0004](adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md) links the primary format reference.

Preview contains evidence, diagnostics, the Binding Plan and dispositions `new-game`, `reuse-game`, `existing-installation` or `conflict`. Reliable Steam App ID can reuse an existing Game across distinct installations. Names never merge Games. An equal Location on the same Host under another source, or contradictory Steam identity at an occupied Location, is a visible conflict. New records use UUIDv7 and empty `launchEntries`; this slice discovers no launch entries and does not start games, enrich metadata, or mutate game files.

Candidates with unknown Location types or unsupported schema versions remain in the preview with `unverified` validation, `conflict` disposition and a `location-unavailable` diagnostic; they cannot be admitted, while valid candidates in the same batch can be selected and admitted independently.

Confirmation treats the preview as untrusted strict-schema input, independently anchors caller root, checks the digest, re-reads configuration revision, re-discovers source observations with the original Adapter bindings and scope, and compares the rebuilt plan before allocating entity IDs. The digest detects changes, not authenticated signatures. There is no TTL. A changed Workspace or source requires a new preview. A fresh preview after successful admission confirms unchanged; replaying the successfully consumed original preview is stale. `--operation-id` does not turn stale preview replay into recovery.

Import adds selected Game/Installation records while preserving existing Host/source records, comments and bytes. It follows the existing layout and Host companion container, shares rename's writer lock, checks original/target hashes and retains a local journal. Each new file is staged and fsynced in its destination directory, then published through an exclusive hard link without replacing an existing target. The Workspace filesystem must support hard links; unsupported publication fails without falling back to overwrite. Joint creation across files is not atomic. A partial failure reports `recovery-required`; the explicit recovery command forwards the existing operation to completion without needing a fully readable partial Workspace. External modifications stop recovery visibly; no missing journal/receipt can create a fresh operation. Receipt recovery can return unchanged. This is neither a general transaction API nor admission rollback, and it does not automatically retry old previews.

## Location availability and persistence

[ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) separates core metadata persistence from Extension Location behavior. Inspection returns original locations with validation, availability and Binding Plans, without requiring a resolved path. Fresh admission compares candidates and existing installations through bound behavior; unknown/incomparable locations cannot pass as different. Pending import recovery restores already approved metadata from its journal without accessing Location resources or requiring filesystem Location registration. Core `@konogame/workspace-configuration` owns the existing locks, hashes, journal and read/rename/import algorithms; Node read/rename transport is retained, while import I/O is injectable. Location TOML examples and independent versions are in the [Location guide](005-LOCATION-AND-REGISTRIES.md).

Application composition now discovers manifests before activating selected implementations. Workspace inspection activates the Module-owned configuration Adapter; location behavior is activated only when required, so missing Location Extensions still do not prevent reading or approved journal recovery. CLI initializes on application demand and releases owned implementations; help/schema/version do not initialize it. See [services and Extension lifecycle](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) and [ADR 0006](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md). Workspace schema 4 and the admission/recovery limits above remain unchanged.

Installed Extension roots are opt-in; extension list/status/refresh only prepares declarations and never starts package code. Business operations still activate compatible Adapters on demand, while schema 4, unknown Location retention and approved import recovery are unchanged. Discovery, load, activation, and cleanup now have cancellation/deadline diagnostics; this does not give game/configuration writes a new transaction or rollback guarantee. See the [comparison and package guide](007-EXTENSION-SYSTEM-COMPARISON.md).

## Initialization and reviewed maintenance

Workspace initialization, Host/source/root maintenance, strict single-record metadata/settings editing, library queries and settings explanation are now implemented through [ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md). Follow the [management guide](008-WORKSPACE-MANAGEMENT.md) for commands and fresh-review/recovery limits. Preserve UUID/uniformName/Location, source references and unrelated TOML bytes; settings replacement is a complete layer rather than a deep patch. Metadata editing/recovery needs no Location execution, Git or daemon. Unchanged results preserve record bytes while writer coordination may still touch recovery files. Arbitrary editing, history and launch remain future work.

## Effect execution and interruption

Configuration Ports and I/O now return typed Effects under owner Layers; Scope owns writer locks/handles and only releases acquired resources. Preview remains read-only and apply/recovery retains the documented root/revision/evidence and approved-metadata checks. Interruption remains Interrupt; retain recovery material and inspect structured stderr logs for recovery-required failures. Minimal native publication can finish before interruption is observed. Cleanup budgets are cooperative, and Effect 4.0.6 nested bracket interruption can omit an additional finalizer failure from the outer Cause. See the [lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) and [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md). Schema 4 and release versions are unchanged.

[English](002-WORKSPACE-EXPERIMENT.md) | [中文](../zh/002-WORKSPACE-EXPERIMENT.md)
