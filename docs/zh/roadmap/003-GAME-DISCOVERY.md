# 游戏发现与候选录入

Steam 与散装游戏的现有操作见[发现与录入实验指南](../002-WORKSPACE-EXPERIMENT.md)。扩展新来源时遵循[身份决策](../adr/0012-IDENTITY-PERSPECTIVES-AND-PORT-CONTRACTS.md)。

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

[English](../../en/roadmap/003-GAME-DISCOVERY.md) | [中文](003-GAME-DISCOVERY.md)
