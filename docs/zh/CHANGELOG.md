# 更新日志

Core 可执行程序与包使用统一版本；各 Extension 独立版本，分别记录在下方专属小节。本次 alpha 记录当前本机原型，不表示已经发布到软件包仓库。

## Unreleased

- 加入 Biome 推荐检查、行内类型导入/导出、enum 限制与统一格式化命令。
- 分离 Vitest 单元、集成与端到端测试，建立各包独立测试项目及显式 TypeScript 引用。

## 0.1.0-alpha.0 - 2026-10-17

### 新增

- TypeScript Module、Feature、Port/Contract、Operation、Capability、Extension、Adapter 和 Binding Plan，CLI 与 Daemon 复用应用服务。
- 流式多文件 Artifact 与默认 filesystem 存档存储，不强制启用历史或 Daemon。
- TOML 1.0 Workspace Schema 3，分离 Game、Host、Installation 身份，支持 UUIDv7、七层覆盖、显式清除、类型化路径和任意 Host roots。
- Unicode `uniformName` 文件名投影、等价文件/目录布局，以及保留注释、检查冲突并支持中断恢复的重命名。
- oclif 与 Clack 命令行、安全 ESM 入口、tsdown 构建、Vitest 验证及直接解析源码的分层 TypeScript 项目配置。
- 双语架构、ADR、路线图与历史文档存档。
- 项目 metadata 真源、统一 Core 版本、独立 Extension 版本、Contract 兼容范围、软件兼容声明及本地 release 维护命令。

### 兼容性

- Core 版本：`0.1.0-alpha.0`；Contract 协议版本：`0.1.0`；兼容 Contract 范围：`>=0.1.0 <0.2.0`。
- 实验阶段 Schema 和 API 允许 breaking change，不提供历史迁移或兼容读取层。
- `latest` 表示软件版本尚未固定或测试不足；`generic` 表示基于协议/格式、不绑定软件发行号的适配。路线图中描述的未来 Extension 尚未实现。

## konogame.filesystem@0.1.0-alpha.0 - 2026-10-17

### 新增

- `filesystem.save-store`：流式多文件存档存储。
- `filesystem.workspace-configuration`：严格 TOML 检查与实体重命名、恢复。

### 兼容性

- Contract 范围：`>=0.1.0 <0.2.0`；运行软件：Node.js `>=26`。
- 本 Extension 的版本独立于 Core 推进。

[English](../../CHANGELOG.md) | [中文](CHANGELOG.md)
