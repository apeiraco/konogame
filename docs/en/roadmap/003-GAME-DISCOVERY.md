# Game discovery and candidate admission

Status: partially implemented, 2026-10-17. Steam and filesystem standalone discovery, read-only preview, explicit admission and targeted import recovery are implemented. [ADR 0004](../adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md) records accepted decisions; the [experiment guide](../002-WORKSPACE-EXPERIMENT.md) documents exact CLI behavior and limits. `save.discover` remains a separate unimplemented contract. The rest of this document proposes later work.

## Implemented baseline

`@konogame/game` defines `game.discover` through `game.discovery/discover`. An existing configured Host/source selects the required source capability, and a Binding Plan checks the Contract, Operation and active implementation. `filesystem.game-discovery` handles standalone directories; `steam.game-discovery` is shipped by independently versioned `konogame.steam@0.1.0-alpha.0` with software compatibility `steam = "generic"`.

Users explicitly provide scope. CLI resolves paths to absolute scope, defaults standalone depth to 1, accepts exact-directory depth 0 and relative prefix exclusions, and never infers scanning permission from Host roots or source declarations. Steam scans only selected libraries; `libraryfolders.vdf` references do not expand scope. Links, malformed manifests, missing/incomplete installations and access failures produce bounded failures or diagnostics. Data-only KeyValues parsing is limited and validated with synthetic fixtures, without an all-version Steam guarantee.

Preview returns candidate observations, evidence, diagnostics, dispositions and selected bindings without writing records. Directory candidates do not prove game identity; confirmation records the user's selected association. Candidate keys identify observations rather than Game entities. Reliable Steam App ID may reuse a Game; titles cannot merge Games. An equal Location on the same Host under another source is a conflict.

Admission strictly validates preview input, independently anchors root, re-reads revision and source evidence with the original bindings, and reconstructs validated records. The digest detects changes, not authenticated signatures; no TTL applies. Fresh duplicate previews can confirm unchanged; successfully consumed old previews become stale. New installations have empty `launchEntries`. Multi-file Game/Installation creation uses a shared writer lock, hashes and a journal with explicit forward recovery; it is not atomic or a general transaction API, and external modifications stop recovery. Existing Host/source bytes and comments remain intact. No network enrichment, executable discovery, launch or game-file mutation occurs.

## Proposed domain stages

| Feature | Owner | Future result |
| --- | --- | --- |
| `game.identify` | Game Module | Reviewable identity proposals for ambiguous candidates. |
| `game.enrich` | Game Module | Metadata/artwork proposals with provenance. |
| `save.discover` | Save Module | Save/settings location candidates for a known game/installation. |

Game discovery, identity and metadata stages should remain independently selectable. Workspace services validate and persist admitted records; Save owns save locations and export semantics. Broader source creation and editing need reviewed workflows, not implicit mutations during scanning. Keep Game identity separate from multiple local installations.

## Next discovery increments

Add progressive candidate delivery, cancellation feedback, bounded concurrency and per-source partial outcomes before durable scan sessions. Current results are a completed in-memory collection; streaming updates and restart checkpoints are future work. Keep first launch free of automatic discovery. A broader scan is an explicit user request.

Add Epic, Xbox managed locations and Ubisoft/EA only with concrete local format fixtures. The current resolver selects one Adapter per request. Future multi-source workflows can make several requests and merge observations deterministically at the application boundary; a composite public plan requires its own contract decision. Preserve provenance, user corrections and conflicting identities. Completion order must not silently change results, and partial source failure must remain visible.

Evaluate the [Ludusavi Manifest](https://github.com/mtkennerly/ludusavi-manifest) or a Ludusavi process Adapter for save-location knowledge. Neither upstream details nor registry semantics should leak into storage. Define typed save locators for filesystem paths/patterns and registry keys, with explicit platform/expansion context. Finding an expected path differs from verifying existing save data; export produces a streamed Artifact.

Online metadata and local/remote AI remain optional Adapters. Specify caching, rate handling, network policy and source-specific matching. A local-only request must never upload content through fallback. Scanned text is untrusted data; require schema-valid proposals, supporting evidence and an explicit unknown outcome. Model output cannot establish identity or authorize writes. A store SDK DLL or one title match is insufficient evidence.

## Review and remaining acceptance targets

Future UI can group candidates, edit proposed fields, ignore/exclude observations and choose enrichment independently through the same application services. Ignoring a candidate must not remove existing Games. Decide observation retention, rule versions, source ranking and cross-source matching before durable indexing. Automated admission, whole-disk background indexing and durable jobs require separate policy decisions.

- Preserve explicit scope and offline behavior as more sources arrive.
- Keep deterministic merge/provenance and visible partial failure across several requests.
- Preserve user corrections and distinguish contradictory Game identities from multiple installations.
- Validate typed filesystem/registry save locators without coupling storage to them.
- Keep writes reviewed and revision-aware; AI never bypasses admission checks.

See the [configuration proposal](002-WORKSPACE-CONFIGURATION.md), [iteration plan](001-INITIAL-ITERATIONS.md), [frontend proposal](004-FRONTEND-EXPERIENCE.md) and [historical discovery design](../archive/005-DISCOVERY-ENGINE.md).

## Location boundary update

[ADR 0005](../adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) makes candidate and installation locations generic values. All existing/candidate comparisons use bound behavior supporting both operands; fresh admission needs valid/comparable locations. Future non-filesystem sources must supply type definitions and compatible Adapters rather than inventing path strings or treating unknown comparison as different. See the [Location guide](../005-LOCATION-AND-REGISTRIES.md).

## Lifecycle boundary

Discovery I/O is a Game-owned boundary. Steam obtains shared filesystem I/O from a declared active dependency scope; new sources follow [ADR 0006](../adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md), with pure manifests/providers and lazy implementation modules. Registering a source does not authorize scanning or require eager activation.

## Discovery and robustness follow-up

Installed Extension discovery is separate from game discovery and never authorizes game scanning. Future source watchers need partial-write/error policies; they must preserve explicit Host/source/scope and admission review. See [ADR 0007](../adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) and the [source comparison](../007-EXTENSION-SYSTEM-COMPARISON.md) for evidence and implementation triggers.

## Workspace management increment

[ADR 0008](../adr/0008-WORKSPACE-MANAGEMENT.md) implements existing-root initialization, Host/source/root maintenance, reviewed metadata/settings replacement and library list/show/explain. See the [management guide](../008-WORKSPACE-MANAGEMENT.md) for the finite supported intents and targeted recovery. These management operations do not grant discovery scope or mutate game resources. Next work remains asset backup/restore, optional configuration history, broader launcher integrations and UI; arbitrary editing/deletion and launch need separate contracts.

[English](003-GAME-DISCOVERY.md) | [中文](../../zh/roadmap/003-GAME-DISCOVERY.md)
