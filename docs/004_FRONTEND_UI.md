# 04 Frontend: 10-foot UI & Interactions

The frontend MUST be navigable entirely via an Xbox/PS gamepad, optimizing for large TVs (10-foot UI).

## 1. Tech Stack Requirements

- **Framework**: React 18+ (Strict CSR, NO SSR).
- **Data Fetching**: `@tanstack/react-query` for API polling and caching.
- **Routing**: `@tanstack/react-router` for type-safe routing.
- **Styling**: TailwindCSS + `shadcn/ui` (customized for Dark/Cyberpunk themes).

## 2. Spatial Navigation & Gamepad

- **Do not rely on native DOM `tabIndex`**.
- Use `@noriginmedia/norigin-spatial-navigation` to wrap components.
- Use `react-use` -> `useGamepad` to listen to native controller inputs (A/B/X/Y, D-Pad). Map A to `onClick`, B to `history.back()`.

## 3. Framer Motion & Shared Layouts (Crucial for UX)

- Avoid hard page cuts.
- Use Framer Motion's `layoutId` property.
- Example: The `<img layoutId={"poster-" + game.id} />` in the grid must smoothly transition into the hero banner of the detail view when selected.
- Physics: Use spring animations (`type: "spring", stiffness: 300, damping: 30`) to simulate console UI inertia.

## 4. Non-Blocking Task UI

- Long-running tasks (extraction, S3 sync) must not block the main UI.
- Display an interactive `Task Drawer` on the side.
- Upon completion, trigger a `shadcn/ui` Toast containing actionable buttons (e.g., `[Launch Game]`, `[View Logs]`).
