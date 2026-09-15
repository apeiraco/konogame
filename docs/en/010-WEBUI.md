# WebUI library and discovery review

WebUI is a browser client for a local Workspace. Vite and TanStack Start build a static SPA. React and Mantine provide the interface, TanStack Router owns navigation and TanStack Query refreshes daemon data after admission. Deep links work in the SPA. Enabling SSR or SSG for selected routes later also requires verifying host and data-loading boundaries.

## From discovery to the library

1. Open the library and select the absolute root of an existing Workspace. Paths refer to the daemon host.
2. Open discovery, choose a configured Host and source, and specify exactly which directory to scan. Request a preview.
3. Review the candidates, evidence and conflicts. Select the records to admit and confirm explicitly. Scan and review again if the preview is stale.
4. Return to the library and open the admitted game's details to inspect its installations. Cards use a local artwork fallback. When you enter details from the keyboard, return to continue from the same game.

## State and lifetime

Each router instance has its own WebUI application context. The composition entry provides the Workspace session, library, discovery review and their storage and HTTP dependencies through Effect Layers. Tests can replace those Layers and run services without mounting React. TanStack Start's client bootstrap and hydration boundary attaches browser resources.

| State or behavior | Owner |
| --- | --- |
| Selected Workspace, library filters and the Game ID to refocus | Services publish shared state through Preact signals. The view binds DOM nodes, scrolls and restores actual focus. |
| Candidate selection, confirmation, submission, conflict and recovery | The review service runs Effect commands and checks whether each completion belongs to the current Workspace and review. The daemon verifies revisions and writes. |
| Remote library, detail and inspection results | TanStack Query owns read caching and invalidation. Cache keys include the selected Workspace root. |
| URL, detail parameters and component tree | TanStack Router owns navigation and React/Mantine renders the view. TanStack generates the route tree; Biome force-ignores it and TypeScript checks its consumers. |

See [browser composition](../../apps/webui/src/app/webui-app-context.ts) for the entry point. The [review service](../../apps/webui/src/game/discovery/discovery-review.service.ts) checks selection and confirmation and interrupts pending requests on a Workspace change. Reopening the same path cannot publish a previous review. Unmounting the view alone preserves the selection. The [library service](../../apps/webui/src/game/library/library.service.ts) keeps filters and the return-focus target for each root.

## Development conventions

Keep the library wall and details in `game/library/`, candidate review in `game/discovery/`, session and record queries in `workspace/`, and the Scalar view in `developer/openapi/`. Place views, services, read models and tests alongside their feature. Use `infrastructure/` for shared HTTP and Effect boundaries and reusable presentation components. Keep route entries in `routes/`.

Filter changes, selection, confirmation checkboxes and focus targets update in memory synchronously. Batch multiple signal changes when observers need to see them together. Effect handles I/O and workflows requiring cancellation or coordination. Read a signal's `.value` during render to subscribe. The build plugin identifies components and hooks with Oxc, prints subscription scaffolding with esrap and applies source-mapped edits with MagicString. Use `.peek()` for intentional untracked reads such as one-time DOM focus restoration.

Use `await using` when an async caller owns a WebUI application context. Router lifecycle callbacks release it through the standard `Symbol.asyncDispose` protocol, while the Effect Scope owns Layer resources. The [client entry](../../apps/webui/src/client.tsx) checks both disposal symbols, both stacks and SuppressedError before importing the application. The Workspace input waits for hydration and session restoration. See the [Signals transform](../../apps/webui/tools/signals-transform.ts) for tracking rules and source mapping.

Editing a tracked component or hook during development reloads the page. The current Oxc Fast Refresh transform does not generate a complete hook signature inside the tracking `try/finally`. Ordinary signal writes still update subscribed views without reloading the page.

## Interface language and time APIs

The first visit uses Simplified Chinese. Select English or 简体中文 in the application shell to switch in place. The browser remembers the preference for later visits. The Workspace, game IDs, reviewed preview and selected candidates survive a language change without a new scan. The preference is stored in browser local storage independently of Workspace files. Prerendering and initial hydration use the same default, then restore the preference and update the HTML language.

Each WebUI app context creates its own i18next instance. Features ship local catalogs with stable semantic keys and interpolation. Tests check matching English and Chinese messages, parameter names and locale-specific plural forms. When adding an action, cover its control label, accessible name and error summary. Preserve game titles, file paths, protocol IDs and raw daemon diagnostics. The Scalar wrapper and viewer follow the selected interface language. The OpenAPI contract, example values and third-party diagnostics retain their original text.

Browser bootstrap checks for Temporal and dynamically loads the packaged `@js-temporal/polyfill` when it is missing. Native Temporal is used when present. Intl always comes from the platform.

## Developer reference

Visit `/developer/openapi` to load Scalar. It fetches the current contract from the same-origin `/api/openapi.json`. Both application and reference requests reach the local daemon. See below for launch and test commands.

## Run and verify

Run `just build` followed by `just daemon` and open `http://127.0.0.1:38417/`. For development keep the daemon running, run `just webui-dev` in another terminal, and visit `http://127.0.0.1:5173/`. Vite validates local requests and forwards same-origin `/api` traffic, including JSON POST. Open `/developer/openapi` directly to read the reference and send a request.

The browser end-to-end test drives Chromium with Playwright. Use local Chrome, install a test browser with `pnpm exec playwright-core install chromium`, or set `KONOGAME_TEST_CHROMIUM` to an executable. `just check` builds the frontend and runs the real browser workflow.

Iteration 10 delivers a functional prototype. Iteration 11 can redesign its information layout, visual language, theme, cards and controls. Explicit review, same-origin access, navigation and focus behavior are the handoff requirements.

[English](010-WEBUI.md) | [中文](../zh/010-WEBUI.md)
