# 05 Progressive Funnel Discovery

> Historical proposal. Save discovery is only a Port definition in the [current architecture](../001-ARCHITECTURE.md).

Discovery is STRICTLY OPT-IN. No automatic background scanning without explicit user consent to respect privacy and avoid I/O bottlenecks.

## The 4-Level Funnel Architecture

### Level 1: Local Heuristics (Rust)

- Fast scan. Looks for engine footprints.
- Targets: `data.xp3` (Kirikiri), `www/` (RPG Maker MV/MZ), `steam_api.dll` (Steam).

### Level 2: Target Probing (Rust)

- Probes predictable paths for saves based on the engine discovered in Level 1.
- Checks `$USERPROFILE/Documents`, `$APPDATA/LocalLow`.
- Checks Windows Registry (`HKCU\Software\`) for Unity `PlayerPrefs`.

### Level 3: Network Metadata (Node.js Plugin)

- If an AppID or distinct folder name is found, dispatch to a Node plugin.
- Scrapes SteamDB, PCGamingWiki, or VNDB API to retrieve high-res covers, correct titles, and standard cloud save paths.

### Level 4: AI Heuristic Fallback (Python Plugin)

- For obscure doujin games with no standard structure.
- Python plugin reads `readme.txt` or `お読みください.txt` in the game folder.
- Sends content to local LLM with the following prompt structure:
  > "You are a game directory analyzer. Read the following Japanese manual. Extract the 'Translated Chinese Title' and the 'Exact Save File Path' (relative to game root or absolute). Return strictly as JSON: {\"title\": \"...\", \"save_path\": \"...\"}"
- Rust parses this JSON and automatically generates the `konogame.toml` manifest.

[English](005-DISCOVERY-ENGINE.md) | [中文](../../zh/archive/005-DISCOVERY-ENGINE.md)
