# Game discovery and candidate admission

Status: proposal, 2026-10-17. No Game Module or discovery pipeline is implemented. The existing `save.discover` definition is a contract boundary only. Feature names below are candidates, not CLI commands.

This proposal builds on the [current architecture](../001-ARCHITECTURE.md), [Workspace proposal](002-WORKSPACE-CONFIGURATION.md), and [iteration plan](001-INITIAL-ITERATIONS.md).

## Intent inherited from the archive

Retain explicit initiation, bounded local discovery, optional network enrichment, engine rules, and optional AI assistance from the [old discovery design](../archive/005-DISCOVERY-ENGINE.md). Turn 15 of the [original discussion, available in Chinese](../../zh/archive/100-INIT-DISCUSSION-BACKUP.md) describes the intended user choices.

Replace the fixed four-level, language-specific funnel with independently selectable stages. A filename or engine signature supplies evidence, not proof of a game's identity. An AI response supplies a candidate, not a verified location or permission to edit a Workspace.

## User intents and domain boundaries

| Candidate Feature | Proposed owner | Result |
| --- | --- | --- |
| `game.discover` | Game Module | Candidate installations within explicitly selected sources or locations. |
| `game.identify` | Game Module | Proposed identity and external-ID matches for candidates. |
| `game.enrich` | Game Module | Proposed metadata, such as titles or artwork, with provenance. |
| `save.discover` | Save Module | Candidate save or settings locations for a known game/installation. |

Game Module owns the discovery workflow and game identity semantics. Save Module understands save locations and export semantics. Workspace services validate and persist admitted records. Admission can initially be an application command; it does not require a new public Feature for every internal step.

A user may import a known store library, identify an already selected directory, or enrich an existing Game independently. Do not require every request to run all stages. Whether game-settings discovery stays in Save remains linked to the Workspace proposal.

## Scope and execution flow

The proposed flow is select scope, collect candidates, identify/enrich as requested, review evidence and conflicts, then admit selected changes. A dry run ends with candidates and a proposed configuration diff.

The accepted schema uses Host `roots` only as arbitrary absolute-path aliases for `fs.relative` installation locations; `fs.absolute` is the default and `managed` references remain supported. Sources no longer have `roots`. Store libraries, scan roots, depth, and exclusions need an independently selected discovery scope; neither a source declaration nor a Host root authorizes scanning. Admission allocates lowercase UUIDv7 IDs and original `uniformName`; filename suffixes never establish identity. See [ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md).

Start no discovery automatically on first launch. The entry point should offer configured store libraries and selected folders first; a whole-disk request is an explicit broader scope. Specify traversal depth, exclusions, symbolic-link/reparse-point handling, and access-error reporting. Local-only mode does not contact metadata services or remote models. Network enrichment and local/remote AI have separately visible options.

Enumerating configured Workspace members is distinct from searching unknown locations. Discovering a library must not execute candidate game binaries. Reading detailed files or registry locations should be limited to the selected task and its rules.

Stream candidate updates so users can inspect partial results and cancel. Keep stable candidate IDs within a session, bounded concurrency, and per-source failures. Cancellation leaves already displayed candidates available for review but does not admit them. Durable checkpoints and resume after process restart can follow a reliable initial session model.

## Candidate and evidence model

A candidate should contain a proposed entity kind, installation location when known, possible external identifiers, proposed fields, supporting evidence, and conflicts. Each observation records its source Adapter, rule/manifest version, relevant path or source reference, and observation time. Represent certainty as an explainable match category; do not present an arbitrary numerical score as a calibrated probability.

Separate observations from user-approved facts. User corrections take precedence unless the user explicitly accepts a replacement. Keep installation identity distinct from Game identity: two directories may be installations of the same game, and similar names may still describe different games or editions. Admission should be repeatable without duplicating an already admitted installation.

Save discovery needs typed locators, such as a filesystem path/pattern or a registry key, rather than forcing every location into a file-path string. Platform and expansion context must be explicit. An export Adapter interprets a locator and produces a streamed Artifact; storage Adapters remain unaware of registry semantics. Discovering an expected path is different from confirming that save data currently exists there.

## Multiple adapters and Binding Plans

The [current binding ADR](../adr/0001-CAPABILITY-BINDING.md) selects one compatible Adapter per request. Keep that behavior explicit for the prototype. A future discovery workflow can issue several binding requests and merge observations at the Module/application layer; it must not rely on registration order to select one source and silently discard the rest.

The workflow selects source roles according to platform, supported stores/engines, requested scope, network policy, and configured adapters. Capabilities describe support; policy determines eligibility. An explicit incompatible preference remains a reported failure. Binding Plans identify the selected implementations and unavailable source roles. A new composite-plan schema, if needed, requires a separate contract decision.

Proposed merge policy: preserve provenance; prefer explicit user decisions and verified identifiers over filename heuristics; apply field-specific source preferences; report contradictory evidence rather than silently replacing it. Results should remain deterministic for the same evidence and policy regardless of adapter completion order. Losing one optional source should report a partial result, not erase observations from successful sources.

## Adapter and rule strategy

Begin with explicitly configured store libraries and local directory rules. Keep engine signatures and save-location rules independently versioned from core, with fixtures for representative directory layouts. Cache rule versions so a diagnosis can explain which data was used. Cloud-save support, an installed game, and a successfully located local save are separate observations.

Prefer reuse of existing save knowledge through a Ludusavi Extension. The [Ludusavi Manifest](https://github.com/mtkennerly/ludusavi-manifest) describes files, registry entries, platform/store conditions, and identifiers; its primary data is compiled from PCGamingWiki with Steam information. It is designed for other backup tools to implement. Evaluate invoking Ludusavi and consuming its manifest as alternative Adapter implementations; neither path should leak upstream format details into core. Source reference reviewed on 2026-10-17.

Online metadata sources should enter through their own Adapters with caching, rate handling, and source-specific matching. Prefer documented interfaces when available. A store SDK DLL, a directory name, or one third-party title match alone must not establish a final identity.

## AI-assisted discovery

AI is an optional adapter for ambiguous names, manual/readme interpretation, or suggested save locations. Its runtime may be TypeScript, a Python tool, or a local/remote model endpoint. The domain contract does not require a bundled model or a particular language.

Treat scanned text as source data, never executable instructions. Require schema-conforming proposals with supporting excerpts or references and an explicit unknown result when evidence is insufficient. Validate suggested paths against the allowed context and check existence where possible; retain uncertainty when a game has not created its saves yet. A local-only request must not upload content through an AI fallback.

The same admission service handles rule-derived and AI-derived changes. Reviewable results and user corrections should be available without AI. Automatic admission policies, if later needed, require explicit scope and conflict behavior; they are not part of the first delivery.

## Admission and user experience

The review presents candidate groups, source evidence, unresolved matches, and the Workspace changes that would result. Users can accept, edit, ignore, or exclude candidates and choose enrichment separately. Ignoring a candidate should not remove an existing Game.

Admission validates the target Workspace revision as described in the [configuration proposal](002-WORKSPACE-CONFIGURATION.md). If configuration changed during discovery, recompute the diff and report conflicts before writing. Store approved associations and relevant provenance; the separate retention policy for verbose scan observations remains open. Admission does not launch games, apply patches, move saves, or perform backups.

The [frontend proposal](004-FRONTEND-EXPERIENCE.md) covers progressive results and tasks. CLI and UI should expose the same candidate IDs, review decisions, and errors through shared application services.

## First delivery and open decisions

Deliver one bounded local discovery source plus a fake second adapter in contract fixtures to exercise merge behavior. Support explicit review and revision-aware admission before online enrichment. Add a Ludusavi-based save locator next, then optional metadata and AI adapters.

Build on the accepted UUIDv7, original uniform-name, and installation-location rules; resolve cross-source identity matching, save locator representation, provenance storage, cancellation boundaries, source ranking, and whether multiple bindings need a public aggregate contract. Contract fixtures should test semantic results rather than vendor-specific output shapes. Broad background indexing and all-disk automation remain later policy decisions.

## Acceptance targets

- First launch performs no unrequested discovery; local-only sessions make no network requests.
- A bounded scan can be cancelled and report inaccessible directories without changing Workspace records.
- Two adapters reporting one installation merge evidence; ambiguous identities and distinct installations remain distinguishable.
- Results are stable when adapter completion order changes, and partial source failure remains visible.
- Filesystem and registry save locators can both be represented without forcing storage to understand either.
- Review protects existing user corrections, and repeat admission does not duplicate records.
- A changed Workspace revision prevents stale admission; AI output alone never bypasses validation and review.

[English](003-GAME-DISCOVERY.md) | [中文](../../zh/roadmap/003-GAME-DISCOVERY.md)
