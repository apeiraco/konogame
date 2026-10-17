# Workspace 配置与版本管理

状态：部分实现；决策已由 [ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md) 采纳，更新于 2026-10-17。TOML Schema 3、检查与专用重命名属于[当前实验](../002-WORKSPACE-EXPERIMENT.md)，通用编辑、发现录入、历史 Adapter 与启动仍为后续工作。

## 已采纳基础

人工管理配置采用 TOML 1.0，机器 JSON、JSON Schema 与 Artifact manifest 保持 JSON。单一 Zod 模型定义严格记录，仅接受 JSON/TOML 共通值子集，不接受 null、日期/时间、非有限数值或不安全整数。游戏自身 INI/JSON/二进制设置通过领域 Adapter 保留原生语义；导出产生 Artifact，不把所有游戏设置转换成管理 TOML。

Workspace、Game、Host、Installation 与新增 Artifact 的 ID 采用小写 UUIDv7。Game 是用户整理的可移植游戏库身份，Installation 是通过 `gameId`、`hostId` 关联的本机实例，第二个安装拥有独立 ID。发行版/标题相似和外部引用属于审核证据，不自动合并身份。外部引用保持 `{ authority, kind, key }`，key 为结构化字符串映射。实验允许 breaking change，报告不兼容记录并保留用户数据，不增加迁移或旧版本读取器。

Game/Host/Installation 保存原文 `uniformName`，UUID 独自标识记录。`unicode-fs-v1` 文件名编码保留 Unicode/大小写、执行 NFC，将禁用字符、控制字符、`%` 及末尾空格/句点编码，组件超过 255 UTF-8 字节或 UTF-16 代码单元时拒绝且不截断。平铺 `<uuid>-<name>.toml` 与目录 `<uuid>-<name>/<kind>.toml` 布局等价。重复 UUID 失败，名称后缀不一致产生诊断。`workspace.toml` 固定。Host 即使使用平铺记录，也可通过附属目录容纳安装记录。

Host `roots` 把自定义键映射到本机绝对路径。Installation 采用 `fs.absolute`、带 `rootKey`/`path` 的 `fs.relative` 或带外部引用的 `managed`。相对路径只依据所属 Host 根解析且不能越界。来源声明不含 `roots`，未来扫描范围独立建模，不预设启动器库或盘符层级。

七层设置保持为内置 → Workspace → Game → Host → Host/Game → Installation → 调用参数。省略继承，数组替换，选项按 Adapter 替换。`settings.clear` 清除启动选择或列出的 Feature/Adapter 映射键，同层设置/清除冲突时报错。历史模式为 `disabled`，或带必填 `adapterId` 的 `adapter`，不参与覆盖链。引导根与配置 Adapter 选择来自调用方，在读取记录前确定。

## 当前写入单元与后续编辑

`workspace.rename` 使用现有 `workspace.configuration` Port 的 `rename` Operation 与 `configuration.rename` Capability。修改 `uniformName` 与文件系统名称，同时保留 UUID/引用、注释、未改动 TOML 原文与布局。Host 重命名一起移动附属安装容器。专用流程包含写入锁、预期修订、基础哈希、临时内容和恢复信息。目标冲突不覆盖；回滚失败需要恢复，重试限定同一实体和目标。外部编辑器竞争是已说明限制，历史独立处理。

更广泛编辑应沿用应用边界，增加明确校验与语义预览。无效外部编辑阻止写入，基础修订变化时重新计算差异并审核冲突。不把重命名泛化为无限制的多文件事务引擎。发现录入需要为 Game 与 Installation 的联合创建单独设计失败/恢复流程。凭据未来通过 credential Adapter 引用；原始秘密及运行进度不进入可移植记录。

`.konogame/workspace.toml` 与 `games/` 保持可移植。`local/`、缓存与恢复数据默认属于本机并排除在常规版本控制之外。排除规则不等于备份，本机记录显式导出/备份仍需设计。二进制资产位于配置树之外。后续可用数据库构建可重建索引，但不改变配置真源。本机操作不强制依赖 Daemon。

## 独立版本与可选历史

| 版本 | 含义 |
| --- | --- |
| Schema 标记 | 当前实验接受的结构，不保证迁移。 |
| 配置修订 | 观察到的管理配置路径与原始字节，不代表原子快照。 |
| 资产版本/快照 | 已存储的存档、补丁或其他资产内容。 |
| Contract/Extension 版本 | 操作及实现的兼容性。 |

文件系统配置无需 Git。Git Extension 仍是首个建议的配置历史实验。草拟的 `ConfigurationHistoryPort` 包含 `list`、`read`、`findOperation`、`record`，尚无历史 Adapter。`workspace.history` 解析 `list` 与 `history.versioned`。记录应使用操作 ID、预期历史 head、逐路径前置哈希，并明确已知/未知失败。同一操作 ID 换用不同数据必须失败。

初始历史范围仅覆盖固定 `workspace.toml` 和当前 Game 记录布局，包含显式移动/删除；应用与 Adapter 都要校验范围。排除本机记录、凭据、资产、链接及任意仓库文件。读取的历史是需要当前 Schema 校验的不可信输入，不能直接指示替换工作文件。使用独立历史 ref/index，保留用户分支、index、暂存文件与无关工作。先在临时仓库测试，再用于真实数据。导出/同步需要独立策略。

配置写入与历史记录是独立结果。写入成功但历史失败时明确报告，并保留操作身份用于修复。恢复通过应用读取历史、校验当前 Schema 变更、预览/应用，再记录新修订；不倒退共享历史或应用资产。恢复期望设置不代表撤销补丁、恢复存档或改变运行中的游戏。

## 下一阶段与验收

先验证合成散装目录与多安装案例，再增加更广泛的可预览编辑及发现录入。通过有范围、获授权的观察研究启动器重叠和托管启动语义。真实路径、账号标识及游戏清单保持私有，与[发现](003-GAME-DISCOVERY.md)及[前端](004-FRONTEND-EXPERIENCE.md)提案协同推进。

- 无 Git、历史或 Daemon 时仍能检查与重命名。
- 两种布局重命名后保留 UUID 身份与注释；冲突和过期修订保留用户改动。
- 可移植配置跨 Host 移动时不混淆本机根与安装实例。
- 缺失引用、无效值、不兼容 Adapter 与需要恢复的结果保持可见。
- 后续恢复/录入经过审核的应用流程并报告部分影响。
- 历史 Schema 明确报告而非隐式迁移；不假设不透明选项已经通过执行校验。

[English](../../en/roadmap/002-WORKSPACE-CONFIGURATION.md) | [中文](002-WORKSPACE-CONFIGURATION.md)
