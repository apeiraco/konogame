# ADR 0003：发行版本与 Contract 兼容性

> 协议更新：[ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 将当前 Contract 协议改为 `0.2.0`、范围 `>=0.2.0 <0.3.0`。下文原始版本示例保留决策当时事实，发布版本归属与 Location/Schema 规则继续有效。

状态：已采纳，2026-10-17。细化 [ADR 0001](0001-CAPABILITY-BINDING.md) 中的发行策略与精确版本假设。

## 决策

所有 Core 可执行程序/包统一发行版本，每个 Extension 独立版本，初始均为 `0.1.0-alpha.0`。Contract 协议版本与包发行版本分开；初始协议为 `0.1.0`，声明兼容范围为 `>=0.1.0 <0.2.0`。

Module、Extension 和 Adapter 声明 `contractRange`。应用拒绝不兼容的 Module 声明，并用普通 SemVer 范围规则，检查实际协议是否在 Adapter 声明范围内。Binding Plan 暴露具体协议版本和选中的范围。Operation、Capability、优先级和显式偏好的既有语义保持一致。

软件兼容性属于各 Extension 的 `software` 映射，使用 SemVer 范围、表示尚未固定/测试不足的 `latest`，或表示不绑定软件发行号的协议/格式适配的 `generic`。这些标记不能替代 Contract 范围，也不能证明测试覆盖，不增加另一套 Provider 或注册模型。

## 真源与维护

`konogame-metadata.toml` 管理项目/发行身份、包清单、协议/兼容范围和 Extension metadata。dev-cli 同步 manifest/生成的发行源码，分别设置 Core 或指定 Extension 的版本，检查漂移/兼容性，并提取准确的双语 changelog 小节。英文 changelog 以仓库根文件为真源，通过受跟踪的相对符号链接投影；翻译为普通文件。

这些命令仅处理本地维护。发布、签名、打包、仓库/tag 策略需要后续具体交付方案。用法见[发布指南](../003-RELEASE-MAINTENANCE.md)。

[English](../../en/adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) | [中文](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)
