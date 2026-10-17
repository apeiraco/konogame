# ADR 0002: Workspace TOML, identity, rename, and runtime tooling

Status: accepted for the local experiment, 2026-10-17. This supersedes the JSON/null/read-only recommendations in the original Workspace proposal. It does not promise a stable external schema.

## Context

Workspace files need readable names, comments, portable identity, and a narrow safe editing workflow. The CLI needs explicit commands and interactive assistance, while packages need importable entries and reproducible build artifacts. Filesystem work must remain usable without history or a daemon.

## Configuration and identity

Human-maintained configuration uses TOML 1.0 and schema marker `workspace.experimental.3`. Machine output, JSON Schema, and Artifact manifests remain JSON. A single Zod record model supplies validation, types, and JSON Schema. Configuration values use only the TOML/JSON common subset: strings, booleans, finite numbers with safe integers, arrays, and objects. Reject null, dates/times, non-finite numbers, and unsafe integers rather than coercing them.

Omitted settings inherit. Arrays replace. Adapter options replace the whole object per Adapter. Explicit removal uses `settings.clear = { launchEntry?: true, preferredAdapters?: string[], adapterOptions?: string[] }`; setting and clearing the same field/map key in one layer is invalid. `history` is `{ mode = "disabled" }` or `{ mode = "adapter", adapterId = "..." }`. Effective machine output may use null to explain a clear; null is never a TOML configuration value.

New Workspace, Game, Host, Installation, and Artifact IDs are lowercase UUIDv7. Experimental records may be rebuilt deliberately; no legacy reader or migration layer is added. Incompatible records are reported and user data is preserved. UUID alone is identity and all references use UUIDs. Names and filename suffixes never become references.

Game, Host, and Installation carry an original `uniformName` separately from display fields such as title/label. The versioned `unicode-fs-v1` filename codec normalizes the filesystem suffix to NFC, preserves Unicode and case, and percent-encodes forbidden filesystem characters, `%`, controls, and trailing spaces/periods as uppercase UTF-8 `%HH` bytes. It does not lowercase or transliterate to pinyin. Reject a filename component exceeding 255 UTF-8 bytes or 255 UTF-16 code units; never truncate. Original text remains in the record.

Each entity can use either `<uuid>-<encoded-name>.toml` or `<uuid>-<encoded-name>/<kind>.toml`. The two layouts have equal meaning; a duplicate UUID is an error. A mismatched name suffix produces a diagnostic. `.konogame/workspace.toml` stays fixed. A flat Host can have an identically named companion directory containing `installations/`; Host rename moves this container as well.

Installation locations are `fs.absolute` with `path` by default, `fs.relative` with `rootKey` and `path`, or `managed` with a typed external reference. Host `roots` maps arbitrary user-defined keys to absolute paths. It does not prescribe launcher libraries, drive names, or platform categories. Relative locations resolve against their owning Host and cannot escape the chosen root. Source declarations keep `id`, `kind`, and status; remove `sources[].roots`. Future discovery scope needs its own explicit model.

## Rename boundary and recovery

`workspace.rename` uses the existing `workspace.configuration` Port, Operation `rename`, and Capability `configuration.rename`. The application resolves a Binding Plan before I/O. The narrow workflow changes `uniformName` and the record file/directory name while preserving comments, unaffected original text, layout, UUID, and UUID references. Display title/label is independent. Workspace's fixed file is not an entity rename target.

The filesystem workflow coordinates application writers with a writer lock, checks the expected observation revision and file hashes, stages temporary content, retains recovery information, and moves record paths deliberately. Conflicts do not overwrite a destination. A failed rollback is reported as requiring recovery. Retry/recovery is restricted to the same entity and target, with operation identity used to recognize retries. These guarantees do not make arbitrary external editors participate in atomic compare-and-swap. This dedicated rename workflow is not a generalized multi-file transaction engine. History remains an independent optional outcome and is not required for rename.

## CLI and package tooling

Use `@oclif/core` for explicit CLI commands and `@clack/prompts` for TTY assistance. Running without a command opens a menu; missing arguments can be requested interactively. `--non-interactive`, `--interactive=false`, and `INTERACTIVE=false` disable prompts; precedence is flags, environment, then TTY detection. JSON and non-TTY execution do not prompt. Cancellation performs no write. The command is `workspace rename <root> <id> <name>`.

Node 26 ESM entry modules export callable functions and run only under `import.meta.main`; importing them has no startup side effects. Use `import.meta.dirname` and `import.meta.filename` where needed. Each workspace package uses tsdown without bundling to produce its own `dist` JavaScript and declarations, and package exports resolve to build artifacts. `apps/shared/src/index.ts` is the entry of `@konogame/local-runtime`; repository tooling is the `scripts/dev-cli` workspace with `src/main.ts`. Vitest runs the tests. Daily commands enter through `just`. Build artifacts first with `just build`; `just check` forwards to `pnpm check`, which performs build, typecheck, tests, and documentation checks. pnpm and Node remain available for their own scope and for agents.

## Consequences

TOML editing and filesystem naming require focused tests for round trips, conflicts, recovery, Unicode, and both layouts. A rebuild is required before CLI/daemon/dev-cli execution. Broader edits, discovery admission, Git history, launch semantics, and graphical UI remain separate increments. See the [experiment](../002-WORKSPACE-EXPERIMENT.md) for scope and [roadmap](../roadmap/001-INITIAL-ITERATIONS.md) for future work.

[English](0002-WORKSPACE-TOML-AND-TOOLING.md) | [中文](../../zh/adr/0002-WORKSPACE-TOML-AND-TOOLING.md)
