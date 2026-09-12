# ADR 0013：Port 与 Adapter 解析

状态：已采纳，2026-11-03。细化 [ADR 0001](0001-CAPABILITY-BINDING.md) 的术语、[ADR 0003](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) 的兼容性命名及 [ADR 0012](0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md) 的 owner 契约。

## 决策

使用 **Feature → Port ← Adapter**。Module 拥有领域 Feature。Feature 描述用户意图，请求 Port 上的 Operation。Port 拥有该 Operation 的输入、输出、错误和行为保证，Adapter 实现 Port。Extension 是独立分发的包，可以跨 Module 提供多个 Adapter。

契约描述边界的类型、Schema 和保证，不在 Feature、Port、Adapter 之间形成额外层级。公共纯声明保留 owner `/contracts` 入口，包括描述传输数据的 `LocationContract` 等名称。

Capability 是执行前选择兼容 Adapter 时检查的保证。例如 `history.versioned` 要求实现支持历史，不会成为 `put` 的额外参数。实际执行参数属于 Port Operation 的输入。单独请求的历史流程仍是 Feature。

实现选择统一称为 **Adapter 解析**。纯函数 `selectAdapters` 评估 `AdapterResolutionRequest` 值，返回包含 `resolvedAdapters` 与 `unavailable` 的 `AdapterResolutionPlan`。每个 `ResolvedAdapter` 记录所选描述及兼容性事实。这些对象是值，不是资源身份或持久执行句柄。

`ADAPTER_RESOLUTION_PLANNER` 服务将 Feature ID 与偏好转换为解析请求，交给 `AdapterResolver` 并返回 `AdapterResolutionPlan`。

`AdapterResolver` 通过 `ADAPTER_RESOLVER` 暴露，协调准备、选择、惰性激活和实现访问。`resolve` 返回计划，`implementation` 依赖注册表签发的选择凭据取得实现。源码放在 `adapter-resolution/`。流程输出公开计划时使用 `adapterResolutionPlan`。不兼容的显式偏好明确失败，不选择其他 Adapter。保留 Port 版本、Operation、Capability、每个传入 Location Schema 的检查，以及已有优先级与稳定 ID 同分排序规则。

区分三个版本维度：

| 维度 | 名称与归属 |
| --- | --- |
| 声明格式 | `declarationProtocolVersion`、`declarationProtocolRange`；规范 `[declaration_protocol]` 与 Extension 的 `declaration_protocol_range`；生成 `DECLARATION_PROTOCOL_VERSION`、`DECLARATION_PROTOCOL_RANGE`。 |
| Port 兼容性 | Feature/请求的 `portVersion`、Adapter 的 `portVersionRange` 及计划中的已选版本/范围；规范 `[[port]]` 与 Extension 的 `port_version_ranges`；owner 的 `_PORT` 常量提供 `version`、`supportedRange`。 |
| 软件包发行 | Core 共享发行版本，各 Extension 独立发行版本。 |

声明协议保持 `0.2.0`、范围 `>=0.2.0 <0.3.0`。`game.discovery` 保持 `0.3.0`，其余已有 Port 保持 `0.2.0`。`konogame-metadata.toml` 拥有规范声明，release sync 生成投影。Schema 4、Location Schema 和软件包发行版本不变。

## 影响

源码路径、声明、错误、公共 JSON 和预览同步改名，不保留兼容别名或第二套解析机制。当前严格 Schema 拒绝旧实验预览字段，保留用户数据并要求重新预览。当前文档统一采用本术语，归档内容和历史发布记录保留原始用词，旧 ADR 指向本文获取当前名称。

[English](../../en/adr/0013-PORTS-AND-ADAPTER-RESOLUTION.md) | [中文](0013-PORTS-AND-ADAPTER-RESOLUTION.md)
