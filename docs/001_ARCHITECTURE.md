# 01 System Architecture & OS Integration

## 1. Core Philosophy: The Headless Orchestrator

`konogame-server` is a pure backend process. It does not render any windows natively. It exposes its capabilities via two channels:

- **REST API (axum)**: For static asset serving, CRUD operations on `konogame.toml`, and metadata retrieval.
- **WebSocket (tokio-tungstenite)**: For real-time bi-directional events (e.g., extraction progress, AI translation streams, active game status).

## 2. Process Lifecycle & Resource Safety (Windows OS native)

The greatest risk in a multi-process AI tool is zombie processes hoarding GPU VRAM.

- **Implementation**: On startup, Rust uses the `windows-rs` crate to create a Job Object (`CreateJobObjectW`).
- **Kill-on-Close**: Apply `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`.
- **Assignment**: Whenever Rust spawns a Tier 2 plugin (Python/Node `ChildProcess`), it assigns its handle to this Job Object. If `konogame-server.exe` crashes or closes, the Windows Kernel guarantees the immediate termination of all child Python/Node workers.

## 3. Async Isolation Strategy

Do not infect the core logic with `.await` where it's not needed.

- **Async Zone**: Network requests (axum), WebSocket broadcasting, Named Pipe listening. Managed by `tokio`.
- **Sync Zone**: File hashing, 7z/RAR5 extraction, metadata parsing. Managed by `rayon` thread pools or standard threads.
- **Bridge**: Use `tokio::sync::mpsc` channels to pass messages between the Async and Sync zones (e.g., Download completes in async -> passes path to sync thread for extraction -> passes result back to async for WebSocket broadcast).

## 4. Virtualization & Mount Hooks

Games expect files in specific places. We use NTFS Symlinks instead of copying large patches.

- **Mount**: Read `konogame.toml` hooks. Use `std::os::windows::fs::symlink_file` or `symlink_dir` to link patches/saves into the game directory.
- **Unmount**: Wait for the user to select unmount. Remove symlinks immediately. Trigger backup routines on the managed save directory.
