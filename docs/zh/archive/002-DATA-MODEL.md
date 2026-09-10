# 02 数据模型：工作区与分布式配置

> 历史草案。当前 TypeScript 优先架构见[当前架构](../001-ARCHITECTURE.md)。

我们严格避免使用 SQLite/CouchDB。数据真相源是文件系统，仿照 Cargo 工作区模式设计。

## 1. 内存状态管理

- 启动时，Rust 对 `konogame.workspace.toml` 中定义的目录执行快速 glob 扫描。
- 使用 `serde` 和 `toml` crate 解析所有本地 `konogame.toml` 文件。
- 状态保存在全局可访问的 `Arc<RwLock<HashMap<GameId, GameMeta>>>` 中。
- **写入策略**：`konogame-server` 是**独占写入者**。插件通过 IPC 请求变更；它们从不直接写入 `.toml` 文件以防止竞态条件。

## 2. 全局工作区模式（`konogame.workspace.toml`）

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
# 密钥应通过环境变量或 Windows 凭据管理器注入，不要在此硬编码。
```

## 3. 本地游戏清单模式（konogame.toml）

```toml
[package]
id = "vndb_12345"
name = "Bokura no Natsu"
developer = "DoujinCircle"
playtime_seconds = 3600

[assets]
cover = "./metadata/cover.jpg" # 本地相对路径
banner = "./metadata/banner.jpg"

[dependencies]
# 定义由 konogame 管理的可挂载资源
patch_cn = { path = "../../managed_assets/vndb_12345_cn_patch", type = "symlink" }
save_data = { path = "../../managed_saves/vndb_12345", type = "symlink", target = "$APPDATA/DoujinCircle/Save" }

[launch]
executable = "Game.exe"
pre_hooks = ["mount:patch_cn", "mount:save_data"]
post_hooks = ["unmount:patch_cn", "backup:save_data"]
runner = "default" # 可路由到如 "mtool" 等插件
```

[English](../../en/archive/002-DATA-MODEL.md) | [中文](002-DATA-MODEL.md)
