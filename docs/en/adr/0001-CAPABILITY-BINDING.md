# ADR 0001: Feature, capability, and binding terminology

Status: accepted for the initial skeleton (2026-10-17).

Later refinements: [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) adds Module/Extension Adapter ownership; [ADR 0006](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) implements core-owned lazy activation and asynchronous binding. The deferred-loading statement below records the original slice, while capability negotiation remains effective.

## Context

`save.store` must remain a user-visible task even when one adapter has version history and another merely copies files. Calling versioning a sub-feature would blur the boundary between an optional adapter property and a separately requested workflow.

## Decision

Use **Feature** for user intent, **Operation** for a Port method, and **Capability** for an Adapter property. Thus `save.store` is a Feature; `put` is an Operation; `history.versioned` is a Capability. `save.history` is a separate Feature because listing or restoring past versions is an independently requested workflow. It is unavailable when no matching Adapter exists.

Each Extension can publish several Adapter descriptors. The application constructs a Binding Plan for requested Features by matching Port, compatible Contract range, Operation, and required capabilities. It chooses the highest priority compatible Adapter with a stable ID tie-break. Explicit preference limits candidates; failure is visible in `unavailable`. Resolution precedes execution. The plan records selected Adapter and Extension IDs for inspection.

The CLI and daemon share the application service and differ only in transport and process lifecycle. The Contract protocol is versioned separately from package releases. Core packages share a release version, Extensions version independently, and descriptor Contract ranges use SemVer as specified in [ADR 0003](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md). Dynamic loading is deferred.

## Consequences

Basic filesystem storage works without history. A future Kopia Adapter can add `history.versioned` without changing the meaning of `save.store`. An Extension such as OpenDAL or Kopia may implement more than one Module's Port. Multi-file streamed Artifact remains the cross-module payload contract.

[English](0001-CAPABILITY-BINDING.md) | [中文](../../zh/adr/0001-CAPABILITY-BINDING.md)
