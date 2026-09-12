# ADR 0014 · 将 Workspace TOML 实现作为随附 Extension

于 2026-11-03 采纳，调整以下决策的持久化归属，原决定见 [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)。

Workspace 拥有 Feature 声明、配置 Port、UUID 身份和文件名编码。随附的 `konogame.workspace-toml` Extension 提供 `workspace-toml.configuration` 并独立发布。CLI 与 daemon 在读取 Workspace 记录前选择配置来源。

Module 独立登记，缺少配置 Adapter 时仍可枚举 Feature。Extension 负责保留 TOML 原文字节、发布文件、协调写入和恢复，在项目元数据中声明适配的 Port 范围。其他 Adapter 可复用相同领域规则。

配置安装根后，宿主注入 `@konogame/node-installed-extension-source`。目录必须先获得发现来源才能选择和激活已安装包，因此该来源随核心宿主发布。

显式 Adapter 偏好与脚本需要使用 `workspace-toml.configuration`，已有预览需重新生成后再提交。Workspace 记录布局、UUID 命名与 Port 版本沿用现行定义。

[English](../../en/adr/0014-WORKSPACE-TOML-EXTENSION.md) | [中文](0014-WORKSPACE-TOML-EXTENSION.md)
