# ADR 0013: Ports and Adapter resolution

Status: accepted, 2026-11-03. Refines the terminology of [ADR 0001](0001-CAPABILITY-BINDING.md), the compatibility names of [ADR 0003](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md), and the owner contracts of [ADR 0012](0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md).

## Decision

Use **Feature → Port ← Adapter**. A Module owns domain Features. A Feature describes user intent and requests an Operation on a Port. The Port owns that Operation's input, output, errors and behavioral guarantees; an Adapter implements the Port. An Extension is an independently distributed package that can contribute several Adapters across Modules.

A contract describes a boundary's types, schemas and guarantees. It is not another node between Feature, Port and Adapter. Keep the owner `/contracts` entry points for pure public declarations, including names such as `LocationContract` that describe transported data.

A Capability is a guarantee used to select compatible Adapters before execution. For example, `history.versioned` requires an implementation with history support; it does not become an extra argument to `put`. Actual execution parameters belong to the Port Operation's input. A separately requested history workflow remains a Feature.

Call implementation selection **Adapter resolution**. The pure `selectAdapters` function evaluates `AdapterResolutionRequest` values and returns an `AdapterResolutionPlan` with `resolvedAdapters` and `unavailable`. Each `ResolvedAdapter` records the selected descriptor and compatibility facts. These are values, not resource identities or persistent execution handles.

The `ADAPTER_RESOLUTION_PLANNER` service translates Feature IDs and preferences into requests for `AdapterResolver` and returns an `AdapterResolutionPlan`.

`AdapterResolver`, exposed through `ADAPTER_RESOLVER`, coordinates preparation, selection, lazy activation and implementation access. Its `resolve` method returns the plan; `implementation` obtains the implementation through registry-issued selection evidence. Source files live under `adapter-resolution/`. Workflow output uses `adapterResolutionPlan` where it exposes that plan. An incompatible explicit preference fails visibly instead of selecting another Adapter. Preserve Port version, Operation, Capability and every supplied Location schema check, plus existing priority and stable-ID tie-break rules.

Separate three version concerns:

| Concern | Names and ownership |
| --- | --- |
| Declaration format | `declarationProtocolVersion` and `declarationProtocolRange`; canonical `[declaration_protocol]` and Extension `declaration_protocol_range`; generated `DECLARATION_PROTOCOL_VERSION` and `DECLARATION_PROTOCOL_RANGE`. |
| Port compatibility | Feature/request `portVersion`, Adapter `portVersionRange`, and the selected values in the plan; canonical `[[port]]` and Extension `port_version_ranges`; owner `_PORT` constants expose `version` and `supportedRange`. |
| Package releases | Shared core release version and each Extension's independent release version. |

The declaration protocol stays `0.2.0` with `>=0.2.0 <0.3.0`. `game.discovery` stays `0.3.0`; existing other Ports stay `0.2.0`. `konogame-metadata.toml` owns declarations and release sync generates projections. Schema 4, Location schemas and package release versions are unchanged.

## Consequences

Rename source paths, declarations, errors, public JSON and previews consistently without compatibility aliases or a second resolution mechanism. Old experimental preview field names are rejected by the current strict schema; preserve user data and request a fresh preview. Current documentation follows this terminology. Archive contents and historical release records retain their original vocabulary, and older ADRs point here for the current names.

[English](0013-PORTS-AND-ADAPTER-RESOLUTION.md) | [中文](../../zh/adr/0013-PORTS-AND-ADAPTER-RESOLUTION.md)
