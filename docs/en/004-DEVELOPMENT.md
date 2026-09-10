# 04 Development guide

Status: current Effect development conventions, 2026-10-26. See the [architecture](001-ARCHITECTURE.md) and [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md).

## Identity and responsibilities

Game, Host and Installation are UUID entities: names and paths can change without changing identity. Scope, evidence and external references describe values. Candidate keys identify observations, not Games. Reliable Steam App IDs can establish Game reuse; title similarity and directory names cannot. Classify new objects explicitly as entities or values. Schemas and domain services enforce current invariants; classes encapsulate complex behavior.

Domain services express domain decisions. The module that owns a capability coordinates its configuration reads, binding, discovery, review and writes. Extensions own vendor parsing and location-specific I/O. Core Workspace persistence owns TOML and metadata algorithms; its existing Node read/rename transport remains, and import I/O is injectable. The [Game contract](../../packages/game/src/index.ts) defines scope/evidence/candidates; [admission](../../packages/game/src/admission.ts) validates admission and reconstructs records; [Steam](../../extensions/steam/src/index.ts) and [filesystem discovery](../../extensions/filesystem/src/game-discovery.ts) implement the Port; [WorkspaceConfigurationImporter](../../packages/workspace-configuration/src/workspace-import.ts) owns journal and forward recovery.

## Classes and functions

Use classes for stateful services, complex Adapters and workflows sharing dependencies/state. Keep helpers private and expose supported operations. Avoid large `createXxxx` closures or mutually referring function bags. Small pure schema/path/value helpers and composition factories remain appropriate. Classes with several named creation paths use a protected constructor and static factories without constructor overloads.

The filesystem Adapter receives its owner I/O service through its Layer. Classes encapsulate state and algorithms; acquisition and resource ownership remain in Effect/Scope.

## Effect services and tests

Use exactly `effect`, `@effect/platform-node` and `@effect/vitest` 4.0.6. Those versions, and every other external dependency range, are declared once in the default catalog in `pnpm-workspace.yaml`. Manifests reference that catalog with `catalog:`; `catalogMode: strict` rejects a direct range on `pnpm add`. `workspace:` remains the protocol for workspace packages. Package release versions stay in `konogame-metadata.toml`. Owner `Context.Service` tags declare dependencies; native `Layer` values build services, and `Scope` owns resources. Serial `yield*` is for a step that uses the previous result. Independent effects use `Effect.all`; a collection uses `Effect.forEach` with explicit concurrency; `Effect.forkChild` with `Fiber.join` or `Fiber.joinAll` is for work that needs the fiber handles. Side-effecting Ports, Adapters and application workflows return `Effect<Success, Error, Requirements>` with owner tagged errors; schemas, values, parsers and rules remain pure. Promise conversion belongs only to real Node, Optique, Clack, dynamic-import and test boundaries. Run APIs stay at process/framework/test boundaries.

Services, Ports, tags and `provideXxx` Layers live in their owner packages. Infrastructure owns registries, activation, lifecycle, binding, Temporal/ID services, `LOCATION_BEHAVIOR`, binding plans and the extension catalog. Workspace, Game and Save own their workflows and I/O services. Distinct implementations have distinct tags. Layer wiring never substitutes for Contract/Operation/Capability/Location negotiation.

CLI and daemon each merge owner Layers. Catalog-only acquisition prepares declarations; other commands initialize before exposing services. Entries select bundled filesystem/Steam and opt-in installed discovery through pure `/providers` entries. Business packages do not import an entry. Add `packages/layer-composition` only when several cross-feature combinations cannot live in an existing module.

```ts
import { FEATURE_PLAN, provideFeaturePlan, provideIdService, provideInfrastructure } from "@konogame/infrastructure";
import { gameModuleSource } from "@konogame/game";
import { saveModuleSource } from "@konogame/save";
import { workspaceModuleSource } from "@konogame/workspace";
import { Effect, Layer } from "effect";

const infrastructure = provideInfrastructure({}, [
  saveModuleSource(),
  gameModuleSource(),
  workspaceModuleSource()
]).pipe(Layer.provideMerge(provideIdService({
  uuidV7: () => Effect.succeed("01900000-0000-7000-8000-000000000001")
})));

export const program = Effect.gen(function* () {
  return yield* (yield* FEATURE_PLAN).features();
}).pipe(Effect.provide(provideFeaturePlan().pipe(Layer.provideMerge(infrastructure))));

// Importing this module must not start the application.
if (import.meta.main) {
  await Effect.runPromise(program);
}
```

The same rule covers every process script, including a test worker. Export the operation, or run it only under `import.meta.main`. Leave the top level unguarded only when the host cannot load a module. The fixed ID is synthetic. Production uses the UUIDv7 service. Tests replace owner Layers and use `@effect/vitest` and `TestClock` for controlled effects/time; pure tests remain ordinary Vitest tests. Real filesystem/process/PTY tests retain native execution. Exercise replacements through real workflows, including stale revisions/evidence, independent root anchoring, strict fields, catalog consistency, lazy activation, failure publication and cleanup. See the [service/lifecycle guide](006-SERVICES-AND-EXTENSION-LIFECYCLE.md) and [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md).

Effect behavior tests return Effects through `@effect/vitest` `it.effect`, using TestClock for controlled time and real Fiber/Scope cancellation. Native filesystem and live-clock integration tests use `it.live`; do not freeze their clock by default. Test known failures with `Effect.flip`, Exit/Cause and owner tags/issues, without per-test runPromise wrappers. Pure schema/parser/value/type tests remain ordinary Vitest tests; do not wrap pure work in Effect for uniformity. Promise bridges remain only at actual external I/O, framework/process and fixture boundaries; physical fixture cleanup retains one Scope or hook owner.

## Typed rule failures and defects

Expected rejection is classified where the rule or schema is checked, using owner tags and structured fields. Human messages and operation labels do not determine error categories.

| Owner | Known failure protocol |
| --- | --- |
| Contracts | `SchemaValidationError` carries schemaId and issues with path/message/rule plus optional children for union/intersection branches. A parent path may be empty; inspect child paths instead of parsing messages. The pure `assertSchema` uses the schema result API; it does not turn arbitrary evaluator throws into validation failures. |
| Workspace | `WorkspaceInvalidInputError`, `WorkspaceNotFoundError` and `WorkspaceConflictError` carry rule issues or resource identifiers. `WorkspaceRuleFailure` includes these and schema failures. |
| Infrastructure | `FeatureNotFoundError`, `ExtensionNotFoundError` and `BindingUnavailableError` cover missing Features, missing Extensions, and binding, implementation or operation gaps. | 
| Workspace use cases | `WorkspaceSelectionError` and `WorkspaceReviewMismatchError` (`reviewKind: "workspace-edit"`) stay with Workspace management. |
| Game admission | Input, candidate, conflict, review (`reviewKind: "game-discovery"`) and source/location comparison failures stay with admission. |
| Configuration | `WorkspaceConfigurationError` is a public union of schema/rule failures; WorkspaceFileSystemFailure, ConfigurationInvalidInputFailure, WorkspaceWriterConflictFailure and WorkspaceWriterRecoveryFailure data protocols; UnexpectedBoundaryError; and LocationError from fresh admission. Native filesystem and configuration-input classes stay in the configuration implementation package. |

`infrastructureRule`, `workspaceRule`, `admissionRule` and `configurationRule` bridge synchronous rules by preserving recognized error objects as Fail; an unexpected throw from trusted pure code remains Die. Their operation annotation is diagnostic context only. Port Effects retain their natural error unions, including filesystem tag/code/cause; schema or rule rejection must not be mislabeled as I/O. At an explicitly identified external parser/evaluator boundary, known syntax rejection has its structured input category and an unexpected third-party throw may be `UnexpectedBoundaryError` with boundary and original cause. This boundary class is not a catch-all for business workflows, Ports or every schema hook. Exhaustive handling covers declared known unions, not arbitrary third-party behavior or defects.

Configuration result handling recovers only a Cause made entirely of Fail reasons. Any Die or Interrupt propagates through failCause; existing conflict/recovery statuses remain ordinary results, with recovery-required cleanup diagnostics preserved. Tests assert tags and issue fields, exercise catchTag/exhaustiveness for known unions and separately check defects/interruption. See [shared validation](../../packages/contracts/src/validation.ts), [Workspace protocols](../../packages/workspace/src/errors.ts), [binding rules](../../packages/infrastructure/src/binding-errors.ts), [admission rules](../../packages/game/src/admission-errors.ts) and [configuration rules](../../packages/workspace-configuration/src/workflow-errors.ts).

## Test boundaries and task graph

Choose the category before choosing a directory or execution tool. A unit test owns one rule or service, including its ordinary path and its failures; in-memory composition of its declared dependencies, or one Adapter against a real directory, stays a unit test. An integration test is a complete user workflow or a failure of that workflow that has already been identified, such as discovery admission, Workspace rename/import/edit recovery, writer coordination, and cancellation before a write. Integration tests do not start a process. An end-to-end test holds one process observation the test process cannot make: import side effects, built argv, a real terminal, a crash, or a resolve hook that would poison later imports. That observation starts one process. The built argv smoke and the real terminal do not receive injected services or a faked `isTTY`. A child process does not choose the category.

| Vitest project | Location | Test / hook timeout | File scheduling |
| --- | --- | --- | --- |
| `unit` | workspace `src/**/__tests__/**/*.test.ts` | 10s / 10s | Parallel isolated forks |
| `integration` | workspace or repository `tests/integration/**/*.test.ts` | 30s / 30s | Parallel isolated forks |
| `e2e` | workspace or repository `tests/e2e/**/*.test.ts` | 60s / 30s | Parallel isolated forks |

The three projects share one worker policy, so their files run together. Vitest 5 requires separate groups only when worker limits differ. `just test --shard=1/N` slices the same files for CI; each slice still waits for one cached `^build`.

Run `just test --project unit`, `just test --project integration`, or `just test --project e2e`; combine filters as supported by Vitest. `just test` runs all projects. These commands enter pnpm's Turborepo graph: workspace `build` depends on `^build`, produces `dist/**`, and the root `test:run` depends on dependency builds. Test tasks have caching disabled, so a cached build never substitutes for executing tests. Shared build configuration and relevant environment inputs participate in the local build cache. Test filters go to Vitest alone. After changing the actual Node/tool environment, force a rebuild if the existing local cache may reflect the old environment (`pnpm exec turbo run build --cache=local:rw --force`). `just check` retains Biome, the build graph, the root `tsc --build`, tests, docs and release checks. TypeScript remains one root references build to avoid competing `dist-tsc/` writers. Direct CLI/daemon/dev-cli commands still run built Node modules after `just build`.

CLI grammar, help, and completion use Optique's parser and run helpers. Injected prompts and services call the exported runner in process. A command matrix stays on that runner. One fresh process covers one observation the test process cannot make—import side effects, built argv, a real terminal, a crash, or a resolve hook that would poison later imports—and that process lives in an end-to-end test. Built entries run as real processes. The process does not decide the category. An owner-port replacement stays in process and does not mount a virtual filesystem. Effect delays use TestClock.

A package publishes a test replacement only through a `test` conditional export whose other target is null. `@konogame/infrastructure/tests/support` exposes one Layer per service: `deterministicIdLayer` for `ID_SERVICE` and `fixedTemporalLayer` for `TEMPORAL_SERVICE`. Test projects inherit that condition from `tsconfig.test-base.json`, ahead of `monorepo-tsc`. Vitest replaces `resolve.conditions` with its server defaults, so its config puts `test` back on the server environments that resolve test imports. The export points at source, and the package entry does not re-export it, so tsdown does not publish it.

Use execa for subprocess output/status and time bounds. Piped CLI tests observe built CLI output through `cli-testing-library`; that library is independent of the Testing Library organization and does not create a PTY. Real keyboard/prompt/cancellation tests use `node-pty` and the built entry without faking `isTTY`. Keep terminal cases small and check platform behavior explicitly. The `cli-testing-library` upstream warning concerns its own Windows CI behavior; it does not establish a `node-pty` limitation. See [ADR 0010](adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md) for the decision and upstream references.

The current [terminal workflow](../../apps/cli/tests/e2e/terminal.test.ts) was exercised with Windows ConPTY: Ctrl-C returns 130 without changing the selected directory, then typed root input and confirmation initialize a Workspace whose file records that name. This is evidence for that local Windows workflow; other platform terminal behavior still needs its own run.

In-process tests replace an owner I/O port or use a real directory under `temp/tests/`. Do not mount a virtual filesystem, and do not use Effect's `FileSystem` as that replacement. Subprocesses and native filesystem behavior, including permissions, symlinks, rename, and locks, use real directories. A future virtual or remote store belongs to an Extension that implements the existing owner ports; OpenDAL is not a core dependency.

## Disposable files

`temp/` is gitignored and safe to delete. It holds disposable test files and local scratch data, not source, committed fixtures, or user game data. Tests place files and subprocess working directories under `temp/tests/` at the repository root, or under the workspace that owns the test (`apps`, `packages`, `extensions`, or `scripts`). The operating-system temporary directory is often a small tmpfs, so tests do not use it.

Name each directory as a stable hierarchy, for example `extensions/filesystem/temp/tests/unit/game-discovery/directory/<id>`. Only the final entry may be a random lowercase UUIDv7. [`createTestDirectory`](../../tests/support/temp.ts) creates that entry from the test file's location. Intermediate names stay stable; do not put `mkdtemp` suffixes or UUIDs there.

## Location and registry work

Classify Location as a value object. Add a stable type definition to its Extension, declare a Standard Schema or JSON Schema with an independent schema range, then register compatible behavior and a typed implementation. Registration stores `dataSchema` as JSON Schema. Do not add filesystem branches to Workspace or compare serialized values. Core configuration is a Module-owned Adapter; test configuration reads without Location registration. Cover missing schema/behavior, both compare operands, non-path resources and explicit unknown results. Fresh admission needs valid/comparable locations; journal recovery completes approved metadata without executing resources. Follow the [Location guide](005-LOCATION-AND-REGISTRIES.md) and [ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) for ownership and real registration links.

## Discovery and robustness tests

Without a Contribution revision, unchanged scans must preserve load function identity. Built-in source factories create their batch, contributions and loaders once, and discover returns those stable declarations. Sources with revisions must update them when content or loading semantics change; do not force replacement with a fresh closure on every scan or hide real changes behind a fixed revision.

Use strict manifest schemas before relationships/loaders. New sources provide a stable id and cancellable DiscoveryBatch with complete/diagnostics/revision semantics. Test malformed results, partial scans preserving old records, unchanged revisions, conflicts and attempted-code restart requirements. Catalog observers must see consistent catalogVersion/descriptors/generations after internal commit; public results$ is observation only. Test re-entry, late Feature/Location replay and complete request preservation. Replace owner Layers and use TestClock for deadline tests; LifetimePolicy keeps ordinary budget/demandCacheLimit settings. Verify late publications are sealed, rejections observed and incomplete cleanup diagnosed; same-process deadlines cannot kill synchronous code. See [comparison evidence and installed-package usage](007-EXTENSION-SYSTEM-COMPARISON.md) and [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md).

## Initialization and reviewed maintenance

Workspace initialization, Host/source/root maintenance, strict single-record metadata/settings editing, library queries and settings explanation are now implemented through [ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md). Follow the [management guide](008-WORKSPACE-MANAGEMENT.md) for commands and fresh-review/recovery limits. Preserve UUID/uniformName/Location, source references and unrelated TOML bytes; settings replacement is a complete layer rather than a deep patch. Metadata editing/recovery needs no Location execution, Git or daemon. Unchanged results preserve record bytes while writer coordination may still touch recovery files. Arbitrary editing, history and launch remain future work.

[English](004-DEVELOPMENT.md) | [中文](../zh/004-DEVELOPMENT.md)
