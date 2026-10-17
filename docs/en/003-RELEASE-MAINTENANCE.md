# 03 Release metadata and maintenance

`konogame-metadata.toml` is the canonical source for project identity, the core version, Contract protocol version/range, managed package inventory, and independently versioned Extensions. Package manifests and generated runtime metadata are projections maintained by dev-cli. The release commands prepare local files; registry publishing and Git tags are separate delivery work.

## Versions and compatibility

All core binaries and packages share `project.version`: the repository root, contracts, Workspace, Save, application, shared runtime, CLI, daemon, and dev-cli. Each `[[extension]]` owns its own `version`; changing the core version does not change an Extension version. Equal initial numbers do not couple their release schedules.

The Contract **protocol** currently remains `0.1.0`, independently of the package release number. Core and the filesystem Extension declare `>=0.1.0 <0.2.0`. This distinguishes the npm package `@konogame/contracts@0.1.0-alpha.0` from the protocol it describes. Modules and Adapters declare `contractRange`; resolution checks it against the actual protocol using SemVer before any operation executes. Binding Plans retain the actual `contractVersion` and the selected Adapter range. Invalid/incompatible ranges are unavailable, and explicit preferences never fall back. Prerelease protocol versions require a range that explicitly admits them under ordinary SemVer rules.

Extension software compatibility belongs to its `software` map. Its values are:

| Value | Meaning |
| --- | --- |
| SemVer range, such as `>=26` | A declared software/runtime constraint. |
| `latest` | Version is unpinned or insufficiently tested; it is not a promise that every version works. |
| `generic` | The adapter targets a protocol or format without a software release-number constraint. |

Only the filesystem Extension is implemented. Its software declaration is Node.js `>=26`. Future Steam Extension metadata can use `software = { steam = "generic" }`; Epic and Kopia Extensions can initially use `software = { epic = "latest" }` and `software = { kopia = "latest" }` until tested ranges are established. These examples do not register Extensions or create another architecture concept. One Extension may declare several software constraints and contribute several Adapters.

`latest` and `generic` are software declaration markers, never Contract range aliases. No external software version probing or automatic installation is implemented.

## Maintenance commands

Build dev-cli first, then inspect or maintain the source:

```sh
just build
just dev-cli release show
just dev-cli release check
just dev-cli release sync --dry-run
just dev-cli release sync
just dev-cli release version 0.1.0-alpha.1 --dry-run
just dev-cli release version 0.1.0-alpha.1
just dev-cli release version 0.1.0-alpha.1 --extension konogame.filesystem
just dev-cli release notes --lang zh
just dev-cli release notes --extension konogame.filesystem --lang en
```

`just build` forwards to `pnpm build`. `just dev-cli` runs the built Node tooling and forwards arguments as native argv. `pnpm build` and `pnpm dev-cli` remain available for that scope and for agents.

`--root` selects a different checkout or disposable test fixture. Structured commands return JSON; notes return Markdown, or structured output with `--json`. Imports have no startup side effects. Version/sync commands validate all their inputs before writing, check for intervening edits, and attempt rollback on ordinary failures. They do not provide Workspace rename's crash-recovery transaction, so review the Git diff after an interrupted maintenance operation. TOML comments and unrelated manifest fields are retained.

For a core release, set the version, finalize matching English/Chinese changelog sections, rebuild, and run `just check`. For an Extension release, select its ID with `--extension`; core versions and other Extensions stay independent. Changing compatibility declarations is an explicit metadata edit followed by `release sync`. The sync command updates all registered projections; the version command only updates the selected release group. Rebuild the binaries after a version change so their version output reflects the new manifests/constants.

`release check` rejects missing/unregistered packages, manifest or generated-source drift, invalid/incompatible Contract declarations, invalid software markers, incorrect English changelog projection, and missing notes in any declared language. `just check` forwards to `pnpm check`, which includes this check after build, type checks, tests, and documentation checks.

## Changelog sources

The English source is repository-root [CHANGELOG.md](../../CHANGELOG.md), exposed as a relative symlink at `docs/en/CHANGELOG.md`. The [Chinese source](../zh/CHANGELOG.md) is a regular translated file. Maintain both versions; do not duplicate the English source.

Core headings use `## <version> - <date>`. Extension headings in the same changelog use `## <extension-id>@<version> - <date>`, allowing independent release notes even when version numbers coincide. Keep `Unreleased` for upcoming changes. Version commands do not invent or translate release notes; finalize the exact version section in each language before the release check can pass.

[English](003-RELEASE-MAINTENANCE.md) | [中文](../zh/003-RELEASE-MAINTENANCE.md)
