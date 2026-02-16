# AI Agent Development Guide

**Context for AI Assistants (Cursor / Windsurf / Cline / etc.):**
This project, `konogame`, is currently in the **initial planning and proof-of-concept phase**. The architecture has been largely designed through LLM interactions.
Your role is to act as a Full-Stack Rust/React Engineer to help implement this architecture step-by-step.

Please strictly adhere to the technical boundaries defined below and reference the `docs/` folder before generating code. Do not introduce alternative architectures (like SSR or SQL databases) unless explicitly instructed.

## 🛠️ Current Architecture Decisions

1. **Target Platform (`docs/01_architecture.md`)**
   - The application is built **exclusively for Windows**. Cross-platform file system handling is not required.
   - Use `windows-rs` for OS-specific features like Job Objects (for process management) and Named Pipes (`\\.\pipe\konogame_ipc`) for IPC.
   - Use NTFS Symlinks for mounting patches/saves instead of copying files.

2. **State Management (`docs/02_data_model.md`)**
   - **No Databases**: Do not use SQLite, PostgreSQL, or ORMs.
   - The source of truth is purely file-based (`konogame.workspace.toml` and individual `konogame.toml` files).
   - Rust reads these files into an in-memory `Arc<RwLock<HashMap>>` on startup. The Rust server is the single writer to these TOML files.

3. **Concurrency (`docs/01_architecture.md`)**
   - Isolate `async` code. Use `tokio` for the network layer (axum, WebSockets).
   - Use `rayon` or `std::thread` for CPU/IO-bound tasks (hashing, extraction) to avoid blocking the async runtime. Connect them using `mpsc` channels.

4. **Frontend Constraints (`docs/04_frontend_ui.md`)**
   - **Strictly CSR**: React 18, Vite, TailwindCSS, `shadcn/ui`, TanStack ecosystem. No Next.js or Nuxt.
   - Designed for 10-foot UI (Gamepad-first). Use Spatial Navigation libraries; avoid relying on standard DOM tabbing.
   - OIDC authentication is handled entirely by the Rust backend. The frontend only consumes HttpOnly cookies.

5. **Plugin IPC (`docs/03_plugin_system.md`)**
   - Tier 1: Heavy tasks (OpenDAL S3 integration, 7z extraction) are built in Rust.
   - Tier 2: Python/Node.js scripts run as child processes. Communication is done via JSON-RPC over Named Pipes.
   - Assume Tier 2 plugins run with standard user privileges.

## 📝 Execution Workflow

1. Acknowledge the module you are asked to build.
2. Read the corresponding `docs/*.md` file for specific context.
3. Write clean, idiomatic code adhering to the rules above.
