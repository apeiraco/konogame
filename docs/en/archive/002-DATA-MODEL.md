# 02 Data Model: Workspace & Distributed Configurations

> Historical proposal. For the current TypeScript-first architecture, see [current architecture](../001-ARCHITECTURE.md).

We strictly avoid SQLite/CouchDB. The source of truth is the file system, modeled after Cargo Workspaces.

## 1. In-Memory State Management

- On startup, Rust performs a fast glob scan of the directories defined in `konogame.workspace.toml`.
- It parses all local `konogame.toml` files using the `serde` and `toml` crates.
- State is held in a globally accessible `Arc<RwLock<HashMap<GameId, GameMeta>>>`.
- **Write Policy**: `konogame-server` is the EXCLUSIVE writer. Plugins request mutations via IPC; they never write to `.toml` files directly to prevent race conditions.

## 2. Global Workspace Schema (`konogame.workspace.toml`)

```toml
[workspace]
members = [
    "library/steam/*",
    "library/doujin/*"
]

[plugins]
node_program = "tools/node/node.exe"
python_program = "tools/python/python.exe"

[storage]
backend = "opendal_s3"
endpoint = "[https://s3.example.com](https://s3.example.com)"
# Secrets should be injected via environment variables or Windows Credential Manager, NOT hardcoded here.
```

## 3. Local Game Manifest Schema (konogame.toml)

```toml
[package]
id = "vndb_12345"
name = "Bokura no Natsu"
developer = "DoujinCircle"
playtime_seconds = 3600

[assets]
cover = "./metadata/cover.jpg" # Local relative path
banner = "./metadata/banner.jpg"

[dependencies]
# Define mountable assets managed by konogame
patch_cn = { path = "../../managed_assets/vndb_12345_cn_patch", type = "symlink" }
save_data = { path = "../../managed_saves/vndb_12345", type = "symlink", target = "$APPDATA/DoujinCircle/Save" }

[launch]
executable = "Game.exe"
pre_hooks = ["mount:patch_cn", "mount:save_data"]
post_hooks = ["unmount:patch_cn", "backup:save_data"]
runner = "default" # Can be routed to a plugin like "mtool"
```

[English](002-DATA-MODEL.md) | [中文](../../zh/archive/002-DATA-MODEL.md)
