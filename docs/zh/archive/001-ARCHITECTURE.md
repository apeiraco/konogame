# 01 系统架构与操作系统集成

> 历史草案。当前 TypeScript 优先架构见[当前架构](../001-ARCHITECTURE.md)。

## 1. 核心设计理念：无头编排器

`konogame-server` 是一个纯后端进程。它不原生渲染任何窗口。它通过两个通道暴露其能力：

- **REST API (axum)**：用于静态资源服务、`konogame.toml` 的 CRUD 操作以及元数据检索。
- **WebSocket (tokio-tungstenite)**：用于实时双向事件（例如：解压进度、AI 翻译流、活跃游戏状态）。

## 2. 进程生命周期与资源安全（Windows 原生）

多进程 AI 工具最大的风险是僵尸进程占用 GPU 显存。

- **实现方式**：启动时，Rust 使用 `windows-rs` crate 创建一个作业对象（Job Object，`CreateJobObjectW`）。
- **关闭即终止**：应用带有 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的 `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`。
- **分配机制**：每当 Rust 启动一个 Tier 2 插件（Python/Node `ChildProcess`）时，它将其句柄分配给此作业对象。如果 `konogame-server.exe` 崩溃或关闭，Windows 内核保证立即终止所有子 Python/Node 工作进程。

## 3. 异步隔离策略

不要在不需要的地方用 `.await` 感染核心逻辑。

- **异步区域**：网络请求（axum）、WebSocket 广播、命名管道监听。由 `tokio` 管理。
- **同步区域**：文件哈希计算、7z/RAR5 解压、元数据解析。由 `rayon` 线程池或标准线程管理。
- **桥梁**：使用 `tokio::sync::mpsc` 通道在异步和同步区域之间传递消息（例如：下载在异步中完成 → 将路径传递给同步线程进行解压 → 将结果传回异步进行 WebSocket 广播）。

## 4. 虚拟化与挂载钩子

游戏期望文件在特定位置。我们使用 NTFS 符号链接而非复制大型补丁。

- **挂载前**：读取 `konogame.toml` 钩子。使用 `std::os::windows::fs::symlink_file` 或 `symlink_dir` 将补丁/存档链接到游戏目录。
- **移除后**：等待用户选择移除挂载。立即移除符号链接。在受管理的存档目录上触发备份例程。

[English](../../en/archive/001-ARCHITECTURE.md) | [中文](001-ARCHITECTURE.md)
