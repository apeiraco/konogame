# ADR 0010: Test boundaries and build task graph

Status: accepted, 2026-10-19.

## Context

The test directory alone cannot explain a test's boundary. A child process that imports `runCli` is an execution tool: help, flags, and refusal to prompt cover one entry, while a rename or inspect covers a Workspace workflow. Identical Vitest budgets also hide the different costs of one service, a full user workflow, and a built executable. Execution exports select `dist`, so tests need current dependency artifacts.

## Decision

Classify tests by the workflow they prove. A unit test owns one rule or service, including its ordinary path and its failures. Composing that service with its declared dependencies in memory, or exercising one Adapter against a real directory, stays a unit test. An integration test is a complete user workflow, or a failure of that workflow that has already been identified, such as discovery admission, Workspace rename/import/edit recovery, writer coordination, and cancellation before a write. Integration tests do not start a process. An end-to-end test holds one process observation the test process cannot make: import side effects, the built executable's own argv, a real terminal, a crash, or a resolve hook that would poison later imports. Cover that whole observation in one process. The built argv smoke and the real terminal do not receive injected services or a faked `isTTY`. A child process does not choose the category: CLI help, flags, JSON, and refusal to prompt are unit coverage of the entry; a rename or inspect that selects or writes Workspace records stays in process unless the observation is the crash itself. Call the exported runner in the test process for a command matrix. Drive Effect delays with TestClock. Synthetic fixtures and controlled failure setup remain appropriate.

Vitest remains the test runner. Unit tests live in `src/**/__tests__/`; integration tests live in workspace or repository `tests/integration/`; end-to-end tests live in workspace or repository `tests/e2e/`. Unit and integration workers use isolated forks. In-process tests replace an owner I/O port or use a real directory under `temp/tests/`. Do not mount a virtual filesystem. Subprocess tests and native filesystem semantics use disposable `temp/tests/` directories.

Unit, integration, and end-to-end files share one worker policy and run together. Vitest 5 requires separate groups only when worker limits differ. `just test --shard=1/N` slices the same files for CI; each slice still waits for one cached `^build`.

Use execa for program invocation and process output/status. Use `cli-testing-library` for observing piped CLI output; its spawn transport is not a PTY. A small real terminal suite uses `node-pty` for keyboard input, visible prompts, and cancellation without faking `isTTY`. Injected prompt tests cover command routing and the cancellation cases of a write workflow. Keep the library's upstream Windows CI warning visible; it concerns `cli-testing-library`, not a demonstrated `node-pty` limitation. Piped or injected tests do not establish terminal support. `cli-testing-library` is independently maintained and is not part of the Testing Library organization.

Turborepo declares artifact prerequisites: workspace `build` depends on dependency `^build` and produces `dist/**`; root `test:run` depends on `^build` and is never cached. `just build`, `just test`, and the testing stage of `just check` enter that graph through pnpm. Test filters reach Vitest without being forwarded into dependency builds. Cache build artifacts locally with declared shared configuration and environment inputs; do not cache successful test output as a substitute for execution. Keep one root `tsc --build` for the TypeScript references graph and its `dist-tsc/` outputs.

`just cli`, `just daemon`, and `just dev-cli` continue to invoke built Node entries directly after an explicit build, preserving clean JSON output. No additional task scheduler is introduced.

## Consequences

The [development guide](../004-DEVELOPMENT.md) records project budgets, scheduling, commands, and fixtures. A process is an execution tool, not a test category. Real workflows verify the shipped entry and files; injected scripts cover one command surface or one identified workflow failure, without claiming terminal or filesystem guarantees. Schema and release versions are unchanged.

## References

- [Turborepo task dependencies and outputs](https://turborepo.dev/docs/crafting-your-repository/configuring-tasks)
- [Vitest file parallelism and project ordering](https://vitest.dev/guide/recipes/parallel-sequential)
- [cli-testing-library and platform limitations](https://github.com/crutchcorn/cli-testing-library)

[English](0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md) | [中文](../../zh/adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)
