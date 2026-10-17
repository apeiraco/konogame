# ADR 0003: Release versions and Contract compatibility

Status: accepted, 2026-10-17. Refines the release and exact-version assumptions in [ADR 0001](0001-CAPABILITY-BINDING.md).

## Decision

Use one release version for all core binaries/packages, and an independent version for each Extension. Start at `0.1.0-alpha.0`. Keep the Contract protocol version separate from those package versions; the initial protocol is `0.1.0` and the declared compatible range is `>=0.1.0 <0.2.0`.

Modules, Extensions, and Adapters declare `contractRange`. The application rejects incompatible Module declarations and resolves Adapters using ordinary SemVer range membership against the actual protocol. Binding Plans expose the concrete protocol and selected range. Operation, Capability, priority, and explicit-preference checks retain their existing meaning.

Software compatibility belongs to each Extension's `software` map, using a SemVer range, `latest` for an unpinned/insufficiently tested declaration, or `generic` for a protocol/format without a software release constraint. Those markers do not replace Contract ranges or prove tested support. They do not add another provider or registration model.

## Sources and maintenance

`konogame-metadata.toml` owns project/release identity, package inventory, protocol/range declarations, and Extension metadata. dev-cli synchronizes manifests/generated runtime sources, sets core or selected Extension versions independently, validates drift/compatibility, and extracts exact bilingual changelog sections. English changelog is a root canonical source with a tracked relative symlink projection; translations are regular files.

These are local maintenance commands. Publishing, signing, packaging, and registry/tag policy require their own concrete delivery work. See the [release guide](../003-RELEASE-MAINTENANCE.md).

[English](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) | [中文](../../zh/adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)
