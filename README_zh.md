# Konogame (このゲーム)

⚠️ **写在前面：关于项目状态与 AI 辅助声明**

> 本项目目前处于**早期规划与概念验证（PoC）阶段**。本仓库内的核心架构蓝图、设计文档以及部分基础代码，均**大量使用了 AI 大语言模型辅助生成与推演**。
> 这是一个旨在探索复杂游戏环境管理的实验性项目，目前的特性列表代表设计方向与目标，尚未达到生产可用状态。

---

Konogame 是一个针对 Windows 环境下游戏生态（如民间汉化、破解补丁、独立同人游戏等）的管理与启动工具。项目尝试通过 C/S 架构、纯文本配置以及进程隔离，来提供一种相对可控且易于备份的游戏资产管理方案。

## 💡 设计目标与特性方向

- **基于文件的配置管理 (Workspace Model)**: 不依赖传统的嵌入式数据库（如 SQLite），尝试采用类似 Cargo 工作区模式的 `TOML` 纯文本进行状态管理，以期提升数据透明度和 Git/云盘备份的便利性。
- **前后端分离架构**: 后端 `konogame-server` 使用 Rust 编写，作为本地常驻服务处理文件挂载（NTFS 软链接）和进程调度；前端 `konogame-ui` 为基于 React 构建的纯 CSR 页面。
- **混合式插件架构**:
  - _Tier 1 (Rust Native)_: 将高频或高负载的 I/O 操作（如解压、OpenDAL S3 备份）内置为原生模块。
  - _Tier 2 (IPC 进程)_: 通过 JSON-RPC 和命名管道，支持 Python/Node.js 等外部脚本接入，用于对接大语言模型本地翻译或进行元数据刮削。
- **大屏交互探索 (10-Foot UI)**: 前端界面设计倾向于手柄操作，尝试引入空间导航（Spatial Navigation）和基础的物理动效。
- **按需触发的扫描机制**: 不默认执行全盘扫描，游戏发现与元数据补充机制采用用户主动触发的渐进式策略。

## 📂 文档导航

请在查阅或贡献代码前，参考以下初步架构文档：

- [`docs/01_architecture.md`](./docs/01_architecture.md): 系统级架构规划与 Windows OS API 交互说明。
- [`docs/02_data_model.md`](./docs/02_data_model.md): TOML 数据模型与 Rust 内存状态同步机制。
- [`docs/03_plugin_system.md`](./docs/03_plugin_system.md): 插件分层设计与 IPC 通信协议草案。
- [`docs/04_frontend_ui.md`](./docs/04_frontend_ui.md): 前端 UI 交互规范与大屏手柄适配思路。
- [`docs/05_discovery_engine.md`](./docs/05_discovery_engine.md): 渐进式游戏目录探测规则。

## 🚀 启动开发环境 (WIP)

(注：以下命令仅供开发环境测试，目前处于持续构建中)

```bash
# 1. 运行 Rust 后端服务 (默认端口 8000)
cd konogame-server
cargo run

# 2. 运行 React 前端
cd konogame-ui
pnpm install
pnpm run dev
```
