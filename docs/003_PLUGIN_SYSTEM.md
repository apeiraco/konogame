# 03 Hybrid Plugin System & IPC

## 1. Tier 1: Native Rust Traits (High Performance)

Built directly into `konogame-server`. Used for operations where IPC overhead is unacceptable.

- `ArchiveEngine`: Wraps `sevenz-rust` or system RAR executables for extraction and hash verification.
- `StorageProvider`: Wraps Apache `OpenDAL` for S3 sync.

## 2. Tier 2: External Processes (High Ecosystem)

Python/Node scripts that run out-of-process.

- **Communication Protocol**: JSON-RPC 2.0 over Windows Named Pipes (`\\.\pipe\konogame_ipc`).
- **Permission Model**: NO SANDBOXING. Plugins have the same OS permissions as the user. Users are explicitly warned upon installing third-party plugins.

## 3. IPC Message Schema Example

When a user clicks "Launch via Mtool" on Game ID `vndb_12345`:

**Request (Rust -> Python via Pipe)**:

```json
{
  "jsonrpc": "2.0",
  "method": "hook.pre_launch",
  "params": {
    "game_id": "vndb_12345",
    "working_dir": "D:\\Games\\Bokura",
    "executable": "Game.exe"
  },
  "id": 101
}
```

**Response (Python -> Rust via Pipe)**:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "success",
    "injected": true,
    "pid": 8542
  },
  "id": 101
}
```

## 4. Plugin Manifest (plugin.toml)

```toml
[plugin]
id = "ext.mtool_runner"
name = "Mtool Integration"
type = "python"
entry_point = "main.py"
capabilities = ["launch_runner"] # Tells Rust this plugin can replace the default EXE launcher
```
