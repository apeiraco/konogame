# 03 混合插件系统与 IPC

## 1. Tier 1：原生 Rust Trait（高性能）

直接内置在 `konogame-server` 中。用于 IPC 开销不可接受的操作。

- `ArchiveEngine`：封装 `sevenz-rust` 或系统 RAR 可执行文件用于解压和哈希校验。
- `StorageProvider`：封装 Apache `OpenDAL` 用于 S3 同步。

## 2. Tier 2：外部进程（高生态性）

作为独立进程运行的 Python/Node 脚本。

- **通信协议**：基于 Windows 命名管道（`\\.\pipe\konogame_ipc`）的 JSON-RPC 2.0。
- **权限模型**：无沙箱。插件拥有与用户相同的操作系统权限。安装第三方插件时会明确警告用户。

## 3. IPC 消息模式示例

当用户在游戏 ID `vndb_12345` 上点击"通过 Mtool 启动"时：

**请求（Rust → Python，通过管道）**：

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

**响应（Python → Rust，通过管道）**：

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

## 4. 插件清单（plugin.toml）

```toml
[plugin]
id = "ext.mtool_runner"
name = "Mtool Integration"
type = "python"
entry_point = "main.py"
capabilities = ["launch_runner"] # 告诉 Rust 此插件可以替代默认 EXE 启动器
```
