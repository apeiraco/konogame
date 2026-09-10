# Frontend experience

Status: proposal, 2026-10-17. This repository has no graphical frontend, launch workflow, or durable task API yet. The interaction model and technology candidates below are proposed work, not implemented capabilities.

Read alongside the [current architecture](../001-ARCHITECTURE.md), [Workspace proposal](002-WORKSPACE-CONFIGURATION.md), [discovery proposal](003-GAME-DISCOVERY.md), and [iteration plan](001-INITIAL-ITERATIONS.md).

## Intent inherited from the archive

Preserve a shared frontend with management and play experiences, controller navigation, artwork, non-blocking tasks, and useful actions after completion. The [old frontend design](../archive/004-FRONTEND-UI.md) describes the television experience; turns 10–14 of the [original discussion](../../zh/archive/100-INIT-DISCUSSION-BACKUP.md) explore shared clients, input, and task notifications.

Replace fixed library versions and blanket rules against native DOM focus with an interaction contract that can be tested. Animation must not own navigation or task state. Sharing UI across hosts does not remove the need for platform-specific permissions, packaging, and testing.

## Implemented CLI baseline

[ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md) accepts Optique command parsers with `@clack/prompts` TTY assistance. A TTY session without a command offers a menu and can request missing arguments. Flags > environment > TTY determines interaction; `--non-interactive`, `--interactive=false`, or `INTERACTIVE=false` disables prompts. JSON/non-TTY runs never prompt and cancellation performs no write. `workspace rename <root> <id> <name>` is the dedicated uniform-name workflow, preserving comments, UUID references, and layout while reporting conflicts/recovery requirements. CLI discovery review is now available as read-only `game discover` JSON plus selected `game import --yes`, with explicit `workspace recover-import --yes` for pending journals. [ADR 0004](../adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md) records current scope; graphical editing/review remain proposed. No launch entry discovery is implemented.

## Two modes, shared actions

| Mode | Primary experience | Shared behavior |
| --- | --- | --- |
| Management | Mouse and keyboard, detailed lists, discovery review, configuration differences, batch selection, and diagnostics. | The same game identity, application commands, validation, capability availability, and task results. |
| Play | Large readable targets, controller navigation, a focused library, installation/launch selection, and quick actions. | The same game identity, application commands, validation, capability availability, and task results. |

Mode changes should preserve the selected Game and relevant context. Play mode can offer a clear path into management for complex edits; it need not reproduce every form as a television overlay. Touch layouts are a later adaptation of these workflows.

Organize navigation around the library, a game's assets and actions, discovery, tasks, and settings. Put Adapter choices in the relevant action settings and diagnostics. A user should not have to understand the internal package graph to store a save or choose an installation.

## Capability-aware actions

The application service should expose action availability for the selected Game, Installation, host, and effective configuration. Suggested states are available, needs configuration, unsupported, and temporarily unavailable, each with an actionable explanation. A declared Port alone does not make an action available.

The UI requests Features and renders application results. It must not independently select vendor tools or duplicate negotiation rules. A detailed view may explain the Binding Plan, including an incompatible explicit preference; the normal action view should explain what is missing and how the user can address it.

For example, filesystem storage can offer storing an Artifact without offering history browsing. Restoring a configuration revision, importing a save, and restoring an asset snapshot require distinct wording and previews. A Binding Plan identifies implementations; it is not a complete preview of file changes or a rollback guarantee.

## Reuse and host boundaries

Share domain-facing types, application-client interfaces, view models, design components, and input actions. Keep filesystem access, process launch, credentials, notifications, and window control behind host adapters. Reusable UI must not depend directly on Node or desktop-shell globals.

Browser and desktop clients should reach the same application services through explicit host/transport boundaries. The existing CLI can continue to run locally without a daemon. The current daemon is a localhost health/plan prototype; it is not a task server or a remotely deployable service.

Show which host owns an installation, a path, and a running task. A path entered in a remote browser refers to the execution host only when that is explicitly established; a browser file selection does not silently become a remote server path. Authentication, authorized host access, and remote deployment require separate decisions before remote operation is offered.

Start with Windows workflows and one local client. Keep browser, desktop shell, and future mobile packaging as host choices, with responsive layouts where useful. Do not promise identical native functionality or zero platform work.

## Initial user journeys

1. **Configure a Workspace:** inspect effective values and their sources, edit a record, validate, review a semantic difference, and apply against its base revision. A conflict returns the user to review. Optional configuration history uses the same validation and preview flow.
2. **Discover games:** choose scope and allowed sources, see incremental candidates and evidence, resolve conflicts or ignore candidates, then review the proposed Workspace changes before admission. Opening the app does not begin scanning.
3. **Use a game's assets:** select a supported action, inspect relevant requirements and consequences, start it, and follow its task. Storage does not imply version history or replication.
4. **Play a game:** select an Installation and launch entry, inspect unavailable prerequisites, and explicitly launch once a launch contract exists. A successful download, import, or patch task can recommend launch without automatically starting the game.

These journeys can first be demonstrated with fixtures. Fixtures must clearly identify unavailable or simulated behavior; they do not establish backend support.

## Keyboard, controller, and focus

Use semantic controls, a logical Tab order, visible focus, and accessible names. Within a composite widget, adopt the keyboard pattern appropriate to that widget; managed focus can use roving `tabindex` or `aria-activedescendant`. This replaces the archived prohibition on `tabIndex`. See the [W3C keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/), reviewed on 2026-10-17.

Map controller input to navigation, confirm, back, and context actions, with visible device-appropriate hints and configurable conventions. Back first closes an active menu/dialog or returns within the application flow; it must not blindly invoke browser history. Avoid mapping every controller event directly to an arbitrary DOM click.

Keep focus separate from selection and animation. Preserve stable item identities through filtering and virtualized lists; restore a useful focus target after a dialog, route change, or removal. Directional navigation and scrolling must cooperate with virtualization. Notifications should not steal focus, and input repeat should not accidentally submit an action multiple times.

The main library, game detail, task inspection, and primary play actions should be usable with either keyboard or controller. Detailed text entry may use a keyboard or a host-provided input method. Test real controllers and assistive technology alongside automated interaction checks before claiming accessibility support.

## Task center and notifications

Task state belongs to the application/execution host. A proposed task model includes a stable task ID, action and target, host, lifecycle state, progress, cancellation support, results, and structured errors. Distinguish a cancellation request from confirmed cancellation, and show any partial effects. Unknown totals should display the current phase or processed amount rather than an invented percentage.

Keep active work and failures accessible in a task center; a toast is a summary with optional actions, not the sole record. Completion can offer view result, inspect logs, or launch when appropriate. Pausing, resuming, and retrying depend on the operation's contract. Do not automatically retry a mutation without a defined recovery or idempotency policy.

The UI should observe jobs, not own their lifetime. A local foreground CLI operation can still end with its process. Continuing work after a window closes requires an execution host with an explicit lifetime policy. Reconnecting to that host should recover a task snapshot and reconcile subsequent events without duplicating work; sequence handling and request identity need a contract before implementation. Persistence across host restarts is a separate, later guarantee.

The first client can support foreground tasks and display the actual lifetime limits. Background operation, event transport, retention, and durable recovery must not be implied by a task drawer alone.

## Visuals and technology candidates

A TypeScript UI with React, Vite, TanStack tools, and a component/style system such as shadcn/ui and Tailwind is a candidate, not a fixed dependency list. Select maintained versions and libraries against the first interaction slice, host constraints, and keyboard/controller tests at implementation time. UI state, server state, transport, and focus management need explicit ownership regardless of library choice.

Use transitions to explain continuity while preserving immediate input feedback. Reduced-motion preferences must be respected. If Motion is selected, its documented reduced-motion controls can support that behavior; animation completion must not gate correctness or focus recovery. See [Motion accessibility guidance](https://motion.dev/docs/react-accessibility), reviewed on 2026-10-17.

Artwork should retain source attribution, originals, derived variants, crop choices, and a useful missing-image state. Bound downloads and cache usage. Optional AI artwork enhancement produces a labeled derivative with provenance; it is not a lossless recovery of missing detail and must not replace the source silently.

## First delivery and open decisions

First demonstrate management views for Workspace inspection/edit previews, discovery review, capability availability, and foreground task feedback. Use a small shared application-client boundary with fixtures where services are absent. Connect each working service as its contract stabilizes, then validate the play-mode library/detail flow and controller focus. Desktop background operation, remote clients, and mobile distribution follow separately.

Decide the first host and packaging, application-client transport, task lifetime and event contract, UI state ownership, focus/virtualization strategy, and Extension UI contribution surface before expanding. Feature action descriptors may describe availability, but do not require every domain workflow to fit an automatically generated form. Record accepted architectural choices in ADRs.

## Acceptance targets

- Management and play views use the same application results and display the same effective action availability.
- An unsupported history action has a clear explanation while ordinary filesystem storage remains usable.
- Workspace edits show sources, validation, differences, and revision conflicts; discovery review does not silently change records.
- Keyboard and controller paths retain visible, predictable focus through dialogs, filtering, and navigation.
- Progress and cancellation reflect actual operation state, including partial results and unavailable pause/resume support.
- Reconnecting to a running task host restores task state without creating a duplicate operation; the supported lifetime is visible.
- Completion notifications offer explicit actions and do not launch games automatically or steal focus.
- Reduced-motion settings and missing artwork remain usable; derived artwork can be distinguished from its source.

## Location boundary update

Present the original Location and its validation, availability, reasons and Binding Plan, as specified in [ADR 0005](../adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md). Unknown types/schemas stay visible and preserved; a path is optional because resolution may return a non-path typed resource. Explain unknown/incomparable comparisons and block fresh admission until required behavior is available. Configuration inspection and approved journal recovery remain usable without Location registration. See the [Location guide](../005-LOCATION-AND-REGISTRIES.md).

## Lifecycle boundary

Use core read-only catalog/activation observables and diagnostics to distinguish declared, inactive, blocked, failed and active implementations. Present `restart-service-required` without implying automatic or Extension-only reload. [ADR 0006](../adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) supplies lifecycle APIs; marketplace/download and installation UI remain future work.

## Discovery and robustness follow-up

Catalog list/status/refresh and structured phase diagnostics are implemented. Future UI must show incomplete cleanup and restart requirements without implying code was killed; installation/marketplace UI, persisted enablement and independent-host controls remain separate work. See [ADR 0007](../adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) and the [source comparison](../007-EXTENSION-SYSTEM-COMPARISON.md) for evidence and implementation triggers.

Workspace initialization, reviewed single-record edits, library queries and settings explanation are now available in the CLI; [ADR 0008](../adr/0008-WORKSPACE-MANAGEMENT.md) and the [management guide](../008-WORKSPACE-MANAGEMENT.md) define their review and recovery boundaries. Future graphical UI should reuse these services and distinguish preview/apply unavailable, unchanged, conflict and recovery-required without implying general undo.

[English](004-FRONTEND-EXPERIENCE.md) | [中文](../../zh/roadmap/004-FRONTEND-EXPERIENCE.md)
