# 03 Release metadata and maintenance

`konogame-metadata.toml` is the canonical source for project identity, the core version, Contract protocol version/range, managed package inventory, and independently versioned Extensions. Package manifests and generated release metadata are projections maintained by dev-cli. The release commands prepare local files; registry publishing and Git tags are separate delivery work.

## Versions and compatibility

All core binaries and packages share `project.version`: the repository root, infrastructure, Workspace, Game, Save, workspace configuration, installed discovery, CLI, daemon, and dev-cli. Each `[[extension]]` owns its own `version`; changing the core version does not change an Extension version. Equal initial numbers do not couple their release schedules.

The declaration protocol remains `0.2.0` with `>=0.2.0 <0.3.0`, separate from package releases and each Port protocol. Public contracts live at the owner /contracts entry (infrastructure, game, workspace, save); the standalone contracts package is removed. Feature `portContractVersion` and Adapter `portContractRange` negotiate each Port independently; Binding Plans retain the selected version/range. `game.discovery` is `0.3.0` with `>=0.3.0 <0.4.0`; existing other Ports stay `0.2.0` with `>=0.2.0 <0.3.0`. Canonical `port_contract` entries own Port versions and each Extension declares fixed `port_contract_ranges` for its Adapters. Extensions must not copy the current host range as a compatibility claim. Release sync generates owner constants and Extension Adapter ranges: edit canonical TOML, never generated files. Core packages publish together at `0.1.0-alpha.0`; Extensions release independently. Schema 4 and `extension.package.1` remain unchanged. See [ADR 0012](adr/0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md).

Extension software compatibility belongs to its `software` map. Its values are:

| Value | Meaning |
| --- | --- |
| SemVer range, such as `>=26` | A declared software constraint. |
| `latest` | Version is unpinned or insufficiently tested; it is not a promise that every version works. |
| `generic` | The adapter targets a protocol or format without a software release-number constraint. |

Filesystem and Steam Extensions are implemented. Filesystem declares Node.js `>=26`; Steam uses `software = { steam = "generic" }`; Epic and Kopia Extensions can initially use `software = { epic = "latest" }` and `software = { kopia = "latest" }` until tested ranges are established. These examples do not register Extensions or create another architecture concept. One Extension may declare several software constraints and contribute several Adapters.

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
