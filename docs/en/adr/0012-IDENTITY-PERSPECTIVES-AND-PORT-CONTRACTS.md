# ADR 0012: Identity, perspectives and owner Port contracts

Status: accepted, 2026-11-02. Refines [ADR 0003](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md), [ADR 0004](0004-LOCAL-DISCOVERY-AND-INJECTION.md) and [ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md).

Terminology and compatibility field names follow [ADR 0013](0013-PORTS-AND-ADAPTER-RESOLUTION.md).

## Decision

Artifact is an opaque streamed boundary payload rather than a Workspace entity; a stored ArtifactReference carries its stable ID. Never buffer file streams to establish value equality.

Workspace/Game/Host/Installation are entities with stable UUID identity. DiscoveryObservation, ExternalIdentity, scope, evidence, provenance, LocationContract and Adapter Resolution Plan are values with defined content equality. Explicit conversions separate Extension discovery observations, Game admission candidates and persisted Workspace records. observationKey identifies a source observation; UUID candidateId identifies the reviewed candidate. Neither is a Game ID. New objects must state their entity/value classification, comparison semantics and cross-perspective conversion. DTOs transport data, domain values/schemas enforce invariants, domain services decide matching/conflicts, and application services coordinate resolved Adapters/review/persistence.

Extensions issue opaque {issuer,purpose,value} external identities. issuer must equal the selected Adapter owner ID; purpose separates game and installation identities. Business services compare the complete value and never parse vendor keys. Display externalRefs, paths, titles and priority are not identity. Steam validates manifest AppID against the filename, then issues game identity with issuer konogame.steam and value app:<AppID>. It does not infer account ownership or installation identity. Filesystem uses independently exposed positive volume/file-object IDs scoped by Host, including available positive birth time, to issue installation identity. Paths and mutable size/mtime/ctime or directory evidence fingerprints never enter that identity. Missing reliable file-object IDs means no identity claim. File-object evidence is local to the Host/volume and does not authenticate remote stores or cloned filesystems.

Public pure contracts live in the owning package's /contracts subpath. Infrastructure owns declarations/Artifact/Location; Game owns discovery; Workspace owns configuration/history; Save owns each of its Ports. Remove the standalone shared contracts package and business re-exports through infrastructure. These entries load no implementation. Every Port has an independent protocol: Feature portVersion and Adapter portVersionRange negotiate before execution and are retained in Adapter Resolution Plans. Declaration protocol declarationProtocolRange remains separate. game.discovery advances to 0.3.0 (>=0.3.0 <0.4.0); existing other Ports stay 0.2.0. Canonical metadata and release tooling maintain generated versions. Core packages still release together; Extensions still release independently.

Core and business modules hold no vendor enumeration, parser, path semantics, vendor priority or implementation imports. Composition may select optional bundled Extensions. CLI directory-to-Artifact conversion is selected in composition and injected as a narrow service, preserving lazy import. Third-party Extensions use the same contracts, identity checks and lazy Adapter resolution flow.

## Consequences

This experimental change deliberately breaks old observation and Port declarations. Add no guessed migration or legacy reader: preserve user data and report incompatible records. Synthetic third-party workflow tests must cover identity reuse, conflict, issuer refusal, installation identity and lazy loading without built-ins. Verify behavior, not source-layout/export inventories. Schema 4 and package release versions remain unchanged.

[English](0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md) | [中文](../../zh/adr/0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md)
