# Konogame (このゲーム)

⚠️ **Important Notice: Project Status & AI-Assisted Development Disclaimer**

> This project is currently in the **early planning and proof-of-concept (PoC) phase**. The core architecture blueprints, design documents, and some foundational code in this repository were **heavily generated and refined with the assistance of AI large language models**.
> This is an experimental project aimed at exploring complex ACG game environment management. The current feature list represents design directions and goals, and is not yet production-ready.

---

Konogame is a management and launch tool designed for the Windows gaming ecosystem (such as fan translations, crack patches, indie doujin games, etc.). The project attempts to provide a relatively controllable and easy-to-backup game asset management solution through a client-server architecture, plain text configuration, and process isolation.

## 💡 Design Goals & Feature Directions

- **File-Based Configuration Management (Workspace Model)**: No dependency on embedded databases (like SQLite). Instead, it adopts a `TOML` plain text approach similar to Cargo workspace patterns for state management, aiming to improve data transparency and facilitate Git/cloud storage backups.
- **Frontend-Backend Separation Architecture**: The backend `konogame-server` is written in Rust, serving as a local persistent service handling file mounting (NTFS symlinks) and process scheduling; the frontend `konogame-ui` is a pure CSR application built with React.
- **Hybrid Plugin Architecture**:
  - _Tier 1 (Rust Native)_: High-frequency or high-load I/O operations (such as extraction, OpenDAL S3 backup) are built-in as native modules.
  - _Tier 2 (IPC Processes)_: Supports Python/Node.js external script integration via JSON-RPC and Named Pipes for LLM-based local translation or metadata scraping.
- **10-Foot UI Exploration**: The frontend interface design is oriented towards gamepad operation, attempting to introduce Spatial Navigation and basic physics-based animations.
- **On-Demand Triggered Scanning Mechanism**: No default full disk scanning. Game discovery and metadata enrichment mechanisms adopt a user-initiated progressive strategy.

## 📂 Documentation Navigation

Please refer to the following preliminary architecture documents before reviewing or contributing code:

- [`docs/001_ARCHITECTURE.md`](./docs/001_ARCHITECTURE.md): System-level architecture planning and Windows OS API interaction specifications.
- [`docs/002_DATA_MODEL.md`](./docs/002_DATA_MODEL.md): TOML data model and Rust in-memory state synchronization mechanism.
- [`docs/003_PLUGIN_SYSTEM.md`](./docs/003_PLUGIN_SYSTEM.md): Plugin tier design and IPC communication protocol draft.
- [`docs/004_FRONTEND_UI.md`](./docs/004_FRONTEND_UI.md): Frontend UI interaction specifications and large-screen gamepad adaptation approach.
- [`docs/005_DISCOVERY_ENGINE.md`](./docs/005_DISCOVERY_ENGINE.md): Progressive game directory discovery rules.

## 🚀 Development Environment Setup (WIP)

(Note: The following commands are for development environment testing only. Currently under continuous construction.)

```bash
# 1. Run Rust backend server (default port 8000)
cd konogame-server
cargo run

# 2. Run React frontend
cd konogame-ui
pnpm install
pnpm run dev
```
