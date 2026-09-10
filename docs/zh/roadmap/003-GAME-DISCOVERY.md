# 游戏发现与候选录入

状态：部分实现，2026-10-17。已实现 Steam 与 filesystem 散装发现、只读预览、显式录入和定向导入恢复。[ADR 0004](../adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md)记录采纳决策；[实验指南](../002-WORKSPACE-EXPERIMENT.md)说明准确 CLI 行为与限制。`save.discover` 仍是独立的未实现契约；本文其余部分规划后续工作。

## 已实现基础

`@konogame/game` 通过 `game.discovery/discover` 定义 `game.discover`。已有 configured Host/source 决定必需来源 Capability，Binding Plan 检查 Contract、Operation 与运行实现。`filesystem.game-discovery` 处理散装目录；独立版本 `konogame.steam@0.1.0-alpha.0` 提供 `steam.game-discovery`，软件兼容标记 `steam = "generic"`。

用户显式提供范围，CLI 将路径解析为绝对范围，散装深度默认 1，支持深度 0 精确目录与相对前缀排除；Host roots 与来源声明不授权扫描。Steam 只扫描选定库，`libraryfolders.vdf` 引用不扩大范围。链接、损坏清单、缺失/不完整安装与访问失败产生有界失败或诊断。数据型 KeyValues 解析有限，经合成夹具验证，不承诺所有 Steam 版本兼容。

预览返回候选观察、证据、诊断、处置和绑定，不写记录。目录候选不证明游戏身份，确认记录用户选择的关联。候选键标识观察而非 Game 实体。可靠 Steam App ID 可复用 Game，标题不能合并。同 Host 的相等 Location 来自其他 source 会冲突。

录入严格校验预览输入、独立锚定 root，按原绑定重读修订与来源证据，重建合法记录。摘要用于变更检测，不是认证签名，无 TTL。新预览可对重复录入确认 unchanged，成功消费后的旧预览会过期。新增安装的 `launchEntries` 为空。Game/Installation 跨文件创建采用共享写锁、哈希和 journal，显式前向恢复；不原子、不提供通用事务，外部修改使恢复停止。已有 Host/source 字节与注释保持。本轮不联网补全、不发现可执行入口、不启动、不修改游戏文件。

## 拟议领域阶段

| Feature | 归属 | 后续结果 |
| --- | --- | --- |
| `game.identify` | Game Module | 歧义候选的可审核身份建议。 |
| `game.enrich` | Game Module | 带来源的元数据/图片建议。 |
| `save.discover` | Save Module | 已知游戏/安装的存档或设置位置候选。 |

游戏发现、身份与元数据阶段保持独立可选。Workspace 服务校验并持久化录入记录，Save 负责存档位置和导出语义。创建更多来源与编辑需要可审核流程，不能在扫描时隐式修改。Game 身份与多个本机安装保持区分。

## 后续发现增量

持久扫描会话之前，增加渐进候选、取消反馈、有界并发和单来源部分结果。当前返回完成后的内存集合；流式更新与重启检查点仍待实现。首次启动不自动发现，扩大范围由用户显式请求。

有具体本地格式夹具后再增加 Epic、Xbox 受管位置、Ubisoft/EA。当前解析器每请求选择一个 Adapter。未来多来源流程可发出多个请求，在应用边界确定性合并观察；公开复合计划须单独决策。保留来源、用户修正和身份冲突，完成顺序不能悄悄改变结果，部分来源失败必须可见。

评估 [Ludusavi Manifest](https://github.com/mtkennerly/ludusavi-manifest) 或 Ludusavi 进程 Adapter 提供存档知识。上游细节和注册表语义不泄漏到存储。为文件系统路径/模式与注册表键定义类型化存档 Locator，明确平台/展开上下文。发现预期路径不等于证实已有存档，导出产生流式 Artifact。

联网元数据与本地/远程 AI 保持可选 Adapter，明确缓存、限流、联网策略和来源匹配。本地模式不能通过回退上传内容。扫描文本是不可信数据，要求符合 Schema 的建议、支撑证据和明确的未知结果。模型输出不确立身份或授权写入，SDK DLL 或单个标题匹配不足以证明身份。

## 审核与后续验收

未来 UI 可通过相同应用服务分组候选、编辑建议字段、忽略/排除观察、独立选择补全。忽略候选不能删除已有 Game。持久索引之前先决定观察保留、规则版本、来源排序与跨源匹配。自动录入、全盘后台索引和持久任务需要独立策略。

- 增加来源时保留显式范围与离线行为。
- 多请求保留确定性合并、来源和可见部分失败。
- 保留用户修正，区分 Game 身份矛盾与多个安装。
- 类型化文件系统/注册表存档 Locator 不耦合存储。
- 写入经审核与修订校验，AI 不绕过录入检查。

参见[配置提案](002-WORKSPACE-CONFIGURATION.md)、[迭代计划](001-INITIAL-ITERATIONS.md)、[前端提案](004-FRONTEND-EXPERIENCE.md)及[历史发现设计](../archive/005-DISCOVERY-ENGINE.md)。

## 位置边界更新

[ADR 0005](../adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)将候选及安装位置改为通用值。已有安装/候选之间的比较通过同时支持两侧的绑定行为执行，新录入要求位置有效且可比较。未来非文件系统来源需要提供类型定义及兼容 Adapter，不伪造路径字符串，不将未知比较当作不同。参见 [Location 指南](../005-LOCATION-AND-REGISTRIES.md)。

## 生命周期边界

发现 I/O 是 Game 所属边界，Steam 从已声明且 active 的依赖作用域取得共享文件系统 I/O。新增来源遵循 [ADR 0006](../adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)，提供纯 manifest/provider 和惰性运行模块；登记来源不授予扫描权限，也不要求提前激活。

## 发现与稳健性后续

已安装 Extension 发现独立于游戏发现，不授予游戏扫描权限。未来 source watcher 需明确部分写入/错误策略，保留显式 Host/source/scope 与录入审核。证据及实施触发条件见 [ADR 0007](../adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)和[源码对照](../007-EXTENSION-SYSTEM-COMPARISON.md)。

## Workspace 管理增量

[ADR 0008](../adr/0008-WORKSPACE-MANAGEMENT.md)已实现已有根初始化、Host/source/root 维护、审核元数据/settings 替换及游戏库 list/show/explain。有限意图及定向恢复见[管理指南](../008-WORKSPACE-MANAGEMENT.md)。管理操作不授予发现范围，不修改游戏资源；下一步仍是资产备份/恢复、可选配置历史、更多启动器和 UI，任意编辑/删除与启动需独立契约。

[English](../../en/roadmap/003-GAME-DISCOVERY.md) | [中文](003-GAME-DISCOVERY.md)
