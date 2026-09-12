# Game discovery and candidate admission

For supported Steam and standalone discovery and admission, see the [experiment guide](../002-WORKSPACE-EXPERIMENT.md). New sources follow the [identity decision](../adr/0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md).

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

[English](003-GAME-DISCOVERY.md) | [中文](../../zh/roadmap/003-GAME-DISCOVERY.md)
