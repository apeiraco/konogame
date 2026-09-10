# 02 本地 Workspace 实验

状态：TOML Schema 4、初始化/审核编辑、检查/重命名与本地发现/录入，2026-10-18。采纳决策见 [ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md)，剩余工作见 [Workspace 路线图](roadmap/002-WORKSPACE-CONFIGURATION.md)。实验允许 breaking change，不提供历史迁移或兼容读取器。

## 可运行范围

Workspace Module 与 Save 使用同一 Binding Plan 流程解析检查和重命名，校验严格记录、UUID 关系、显式 Host/Installation 选择、有效配置来源、文件名诊断和内容观察修订。重命名修改实体原文 `uniformName` 与文件系统名称，保留注释、布局、UUID 和引用。

尚无通用配置编辑器、历史实现、游戏启动、基于这些记录的资产绑定或 Daemon Workspace 接口。已配置 Steam/standalone 来源支持下述有界流程；其他来源声明与 Adapter 偏好不代表可用集成。`save store` 仍使用自身存储配置。

## 从仓库运行

```sh
just build
just cli features
just cli plan workspace.inspect
just cli plan workspace.rename
just cli workspace schema
just cli workspace inspect <workspace-root>
just cli workspace inspect <workspace-root> <host-id> <installation-id>
just cli workspace inspect <workspace-root> --adapter core.workspace-configuration
just cli workspace rename <workspace-root> <record-id> <uniform-name>
just cli workspace inspect <workspace-root> --json --non-interactive
```

`just build` 转发到 `pnpm build`。`just cli` 运行已构建的 Node CLI，并把参数作为原生 argv 转发。`pnpm build` 和 `pnpm cli` 仍可供该范围和 agent 直接调用。

显式选择根目录，相对路径依据进程工作目录解析。允许用户选择根目录 projection，但拒绝配置树内部链接，不从应用仓库推断 Workspace。公开示例只用合成数据；本机检查结果可能包含私人路径。

CLI 使用 Optique 命令解析器和 clack TTY 提示。无命令时显示菜单，缺失参数可补问。参数优先于 `INTERACTIVE`，环境优先于 TTY 检测。`--non-interactive`、`--interactive=false`、`INTERACTIVE=false` 禁用提示；JSON/非 TTY 执行不提示，缺失必填值时明确失败。取消提示不写入。

## 格式与记录

人工配置采用 UTF-8 TOML 1.0，机器输出、JSON Schema 与 Artifact manifest 继续采用 JSON。每个记录包含 `schemaVersion = "workspace.experimental.4"`、小写 UUIDv7 `id` 与 `kind`。运行时记录 schema 与导出的 JSON Schema 是同一套结构约束。配置值是字符串、布尔、安全整数范围内的数字、数组和对象。拒绝未知字段、旧标记、null、日期/时间、非有限数值及不安全整数。同一层同时设置并清除同一个设置键是编辑规则，不是第二份 schema。Adapter 历史模式必须带有 adapter ID，禁用历史不能声明 adapter ID；这条配对是记录检查，不是第二份 schema。Adapter 选项对象保持不透明，执行前仍由所属 Extension 校验。

| kind | 公共字段之外的字段 | `.konogame/` 内路径 |
| --- | --- | --- |
| `workspace` | `name`、`defaults`、`history` | `workspace.toml` |
| `game` | `uniformName`、`title`、可选 `edition`、`externalRefs`、`settings` | `games/<id>-<name>.toml` 或 `games/<id>-<name>/game.toml` |
| `host` | `uniformName`、`label`、`platform`、`roots`、`defaults`、`gameOverrides`、`sources` | `local/<id>-<name>.toml` 或 `local/<id>-<name>/host.toml` |
| `installation` | `uniformName`、`gameId`、`hostId`、`sourceId`、`location`、`launchEntries`、`settings` | `local/<host-id>-<name>/installations/<id>-<name>.toml`，或同一 installations 目录内的 `<id>-<name>/installation.toml` |

两种布局语义相同。平铺 Host 可以拥有同名附属目录存放安装记录。UUID 是唯一身份：重复 UUID 报错，关系只引用 ID。`uniformName` 保留原文。文件系统后缀采用 NFC 与 `unicode-fs-v1`：保留 Unicode/大小写，将禁用字符、`%`、控制字符和末尾空格/句点按 UTF-8 字节编码为大写 `%HH`，不转拼音或小写。组件超过 255 UTF-8 字节或 255 UTF-16 代码单元时拒绝且不截断。后缀不一致产生诊断，不形成另一个身份。

历史明确为 `{ mode = "disabled" }` 或 `{ mode = "adapter", adapterId = "..." }`。目前不提供历史 Adapter。指定但不可用、不兼容或未激活的 Adapter 通过共享解析器报告。引导根目录及可选 `--adapter` 来自调用方；已加载配置不能决定自身加载方式。

Workspace 将 Location 保存为可序列化值对象 `{ type, schemaVersion, data }`。Core 只校验通用封装和 JSON/TOML 共通值，不解释文件系统路径。Host `roots` 是相关 Adapter 的上下文；来源保留 `id`、`kind` 与 `status`，不定义扫描范围。filesystem Extension 定义位置 Schema `1.0.0` 的 `fs.absolute`、`fs.relative`，负责 Windows 大小写与相对根限制。未知类型或不支持的 Schema 仍可读取、展示和保留，报告 `unverified`/`unavailable`。TOML 示例与注册用法见 [Location 指南](005-LOCATION-AND-REGISTRIES.md)。

配置记录读写统一以 UTF-8 字节计算，单条上限为 1 MiB；录入与重命名在发布前拒绝超限内容，恢复也按相同上限检查 journal 中保留的记录内容。小型配置元数据读入内存；游戏 Artifact 继续遵守多文件流式契约。修订对排序后的配置路径和原始字节计算哈希，包括本机记录，空白编辑也改变修订。读取修订是观察令牌，不是历史 ID 或原子快照。

## 有效配置

顺序为内置 → Workspace → Game → Host → Host/Game → Installation → 调用参数。字段省略表示继承，数组替换，`preferredAdapters` 按 Feature ID 合并，`adapterOptions` 按 Adapter 整个对象替换。不运行深合并、环境展开或模板。

```toml
[settings.clear]
launchEntry = true
preferredAdapters = ["save.store"]
adapterOptions = ["filesystem.save-store"]
```

同一层不能同时设置和清除同一标量/映射键。`arguments = []` 清空参数数组。检查报告最终来源，可在 JSON 有效值中用 null 表达显式清除；记录本身没有 null。调用覆盖仍为应用 API/测试范围，最终启动语义留待后续。

## 重命名与恢复边界

`workspace.rename` 解析 `workspace.configuration/rename` 与 `configuration.rename`。它修改 Game/Host/Installation 的 `uniformName` 和文件/目录名；title/label 与引用独立。Host 附属容器一起移动，保留现有平铺/目录布局、未改动 TOML 原文和注释。

应用服务提供预期修订与操作身份。核心配置 Adapter 使用锁协调应用写入器，复查修订/哈希，暂存临时内容并保留恢复数据。冲突不覆盖目标，恢复/重试仅适用于同一实体与目标。回滚失败明确报告需要恢复。任意外部编辑器不共享此锁，因此流程不承诺对其提供原子 compare-and-swap。恢复数据不等于历史或通用事务系统。可选历史不影响基本检查和重命名。

合成夹具覆盖 Schema 拒绝、双布局、Unicode 文件名编码和限制、根/位置、分层清除、过期修订、冲突、注释保留与恢复路径。私人观察、账号标识、真实路径及游戏清单保留在公开夹具和文档之外。更广泛编辑和可选 Git 历史属于[后续增量](roadmap/001-INITIAL-ITERATIONS.md)。

## 本地发现与显式录入

Host 必须已声明 `status = "configured"`、`kind = "steam"` 或 `"standalone"` 的来源；发现本身不创建 Host/source，[独立管理流程](008-WORKSPACE-MANAGEMENT.md)现已支持审核创建/维护。`game.discover` 解析发现 Adapter 与 Workspace 检查；`workspace.import`、`workspace.recover-import` 使用 `workspace.configuration` 的 `import`/`recover-import` Operation 与 `configuration.import`/`configuration.import-recovery` Capability。只读配置 Adapter 可以预览，同时在 Binding Plan 中报告录入不可用。

```sh
just cli game discover /synthetic/workspace --host-id <host-id> --source-id loose --scope /synthetic/games --json > /synthetic/preview.json
just cli game import /synthetic/workspace /synthetic/preview.json --candidate <candidate-key> --yes --json
just cli workspace recover-import /synthetic/workspace <operation-id> --yes --json
```

以上为合成路径，请替换为显式选择的本机目录；Windows 可使用 `C:/Synthetic/Games` 等绝对路径。预览保存到观察目录之外：把 JSON 写进扫描目录会改变证据，使确认过期。重定向负责保存 JSON，发现本身不写 Workspace 记录。JSON/非 TTY 录入与恢复要求 `--yes`；`--candidate` 可重复，至少选择一个。TTY 可提示，取消不写入。CLI 导入的预览须为普通 UTF-8 JSON 文件，大小不超过 8 MiB。

`--scope` 显式提供且可重复；CLI 按当前工作目录把相对输入解析为 Port 的绝对范围。`--max-depth` 默认 1，范围 0–16。散装发现中，0 观察所选目录本身，正数观察后代目录且不把所选根作为候选。`--exclude` 可重复，使用 `/` 相对目录前缀，不是 glob。Host roots 与来源声明不授权扫描。

filesystem 候选只是目录观察，以目录名为标题，无便携外部身份。每个合格目录仅是候选；确认记录用户选择，不自动认证目录必然是游戏。不会读取或运行可执行文件内容。目录证据包含目录及直属条目的元信息。链接/junction 和链接祖先被拒绝或诊断，不可访问路径保留诊断。最多访问 10,000 个目录，每目录最多 4,096 条目。

Steam 范围显式选择每个库/root 或其 `steamapps` 目录。只读取所选 `appmanifest_*.acf` 并校验 `common/<installdir>`，不按 `maxDepth` 递归。`libraryfolders.vdf` 提供证据与未选择库的诊断，不扩大扫描权限。App ID 须为正 uint32 且匹配文件名；StateFlags 须包含 fully-installed bit 4，安装目录必须安全、存在且无链接/越界。清单读取上限 1 MiB，条目/候选数量有界。数据型 KeyValues 子集接受引号/裸字符串、花括号对象、`//` 注释及支持的反斜杠转义；指令、条件、重复键、不支持的转义失败。这是经合成夹具验证的实验格式 Adapter，不承诺所有 Steam 版本兼容。[ADR 0004](adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md)链接主格式参考。

预览包含证据、诊断、Binding Plan 与 `new-game`、`reuse-game`、`existing-installation`、`conflict` 处置。可靠 Steam App ID 可在不同安装间复用 Game，名称不能合并。同 Host 的相等 Location 来自其他 source，或已占用 Location 的 Steam 身份矛盾时报告冲突。新记录使用 UUIDv7，`launchEntries` 为空；本轮不发现启动入口、不启动、不联网补全、不修改游戏文件。

位置类型未知或 Schema 版本不受支持的候选仍保留在预览中，标记为 `unverified` 校验、`conflict` 处置并附 `location-unavailable` 诊断；此类候选不可录入，同批有效候选可以独立选择并录入。

确认将预览作为不可信严格 Schema 输入，独立锚定调用者 root，校验摘要，重读配置修订，按原 Adapter 绑定与范围重新观察来源，并比较重建计划后再分配实体 ID。摘要用于变更检测，不是认证签名，没有 TTL。Workspace 或来源变化需要新预览。成功录入后生成新预览可确认 unchanged；重放已成功消费的原预览会过期。`--operation-id` 不会把旧预览重放变成恢复。

录入新增所选 Game/Installation，保留已有 Host/source 记录、注释与字节，沿用现有布局和 Host companion 容器，共享重命名写锁，校验原记录/目标哈希并保留本机 journal。每个新文件先在目标同目录暂存并 fsync，再通过不替换既有目标的独占 hard link 发布。Workspace 所在文件系统须支持硬链接；不支持时发布失败，不降级为覆盖。跨文件联合创建不是原子的；部分失败报告 `recovery-required`，显式恢复命令按既有 operation 前向完成，不要求部分 Workspace 可完整读取。外部修改会使恢复明确停止；缺少 journal/receipt 不能发起新操作，receipt 恢复可返回 unchanged。这不是通用事务 API，不回滚录入，也不自动重试旧预览。

## 位置可用性与持久化

[ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)区分核心元数据持久化与 Extension 位置行为。检查输出原始位置、validation、availability 和 Binding Plan，不要求解析路径。新录入通过绑定行为比较候选及已有安装，未知/不可比较不能当作不同。Pending import 恢复通过 journal 恢复已批准元数据，不访问位置资源，也不依赖 filesystem Location 注册。核心 `@konogame/workspace-configuration` 拥有既有锁、哈希、journal 及读取/重命名/录入算法；保留 Node 读取/重命名 transport，录入 I/O 可注入。位置 TOML 示例与独立版本见 [Location 指南](005-LOCATION-AND-REGISTRIES.md)。

应用组装先发现 manifest，再激活选中实现。Workspace 检查激活 Module 所属配置 Adapter，位置行为仅按需激活，缺少 Location Extension 仍不阻止读取或已批准 journal 恢复。CLI 首次应用需求才初始化并清理自有运行时，help/schema/version 不初始化。参见[服务与 Extension 生命周期](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)和 [ADR 0006](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)；Workspace Schema 4 及上述录入/恢复限制不变。

已安装 Extension roots 显式配置，extension list/status/refresh 只准备声明，不启动包代码。业务操作仍按需激活兼容 Adapter；Schema 4、未知 Location 保留和已批准导入恢复不变。发现、加载、激活和清理现有取消/截止诊断，但不赋予游戏/配置写入新的事务或回滚保证。参见[对照与包指南](007-EXTENSION-SYSTEM-COMPARISON.md)。

## 初始化与审核维护

Workspace 初始化、Host/source/root 维护、严格单记录元数据/settings 编辑、游戏库查询及设置解释已通过 [ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md)实现。准确命令和新鲜审核/恢复限制见[管理指南](008-WORKSPACE-MANAGEMENT.md)。保留 UUID/uniformName/Location、source 引用和无关 TOML 字节；settings 替换完整单层，不是深层 patch。元数据编辑/恢复不要求执行位置，也不依赖 Git 或 Daemon。Unchanged 保留记录字节，协调仍可能触及恢复文件；任意编辑、历史及启动仍待实现。

## Effect 执行与中断

配置 Port 与 I/O 现在通过 owner Layer 返回类型化 Effect；Scope 拥有 writer 锁/句柄，仅释放已获取资源。Preview 仍只读，apply/recovery 保持本文的 root/revision/evidence 与批准元数据检查。中断保持 Interrupt，保留恢复材料并查看结构化 stderr 日志中的 recovery-required。最小原生发布可能在观察到中断前完成。清理预算是协作式的，Effect 4.0.6 嵌套 bracket 中断可能使外层 Cause 遗漏附加 finalizer 失败。参见[生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)与 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。Schema 4 和发布版本不变。

[English](../en/002-WORKSPACE-EXPERIMENT.md) | [中文](002-WORKSPACE-EXPERIMENT.md)
