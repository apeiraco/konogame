# Changelog

Core binaries and packages share a version. Extensions have independent versions, recorded in their own sections below. This alpha records the current local prototype; it is not a registry publication announcement.

## Unreleased

## 0.1.0-alpha.0

### Added

- Add Biome recommended checks, inline type imports/exports, enum restrictions, and shared formatting commands.
- Separate Vitest unit, integration, and end-to-end suites, with dedicated package test projects and explicit TypeScript references.
- TypeScript Modules, Features, Ports/Contracts, Operations, Capabilities, Extensions, Adapters, and Binding Plans shared by CLI and daemon application services.
- Streamed multi-file Artifacts and default filesystem save storage without mandatory history or daemon.
- TOML 1.0 Workspace schema 3 with separate Game, Host, and Installation identities, UUIDv7, seven configuration layers, explicit clears, typed paths, and arbitrary Host roots.
- Unicode `uniformName` projections, equivalent file/directory layouts, and comment-preserving rename with conflict checks and interrupted-operation recovery.
- oclif and Clack command-line workflows, safe ESM entry points, tsdown builds, Vitest checks, and hierarchical TypeScript projects with source-aware editor resolution.
- Bilingual architecture, ADRs, roadmap, and historical archive.
- Canonical project metadata, synchronized core versions, independent Extension versions, Contract compatibility ranges, software compatibility declarations, and local release maintenance commands.

### Compatibility

- Core release: `0.1.0-alpha.0`; Contract protocol: `0.1.0`; supported Contract range: `>=0.1.0 <0.2.0`.
- Experimental schemas and APIs may break without historical migration or compatibility readers.
- `latest` means unpinned or insufficiently tested software compatibility; `generic` means a protocol/format adapter without a software release constraint. Future Extensions described in the roadmap remain unimplemented.

## konogame.filesystem@0.1.0-alpha.0

### Added

- `filesystem.save-store` for streamed multi-file saves.
- `filesystem.workspace-configuration` for strict TOML inspection and entity rename/recovery.

### Compatibility

- Contract range: `>=0.1.0 <0.2.0`; runtime software: Node.js `>=26`.
- This Extension's version advances independently of the core release.

[English](CHANGELOG.md) | [中文](docs/zh/CHANGELOG.md)
