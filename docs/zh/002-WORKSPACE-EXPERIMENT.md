# 02 本地 Workspace 实验

状态：TOML Schema 3、检查与专用实体重命名切片，2026-10-17。采纳决策见 [ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md)，剩余工作见 [Workspace 路线图](roadmap/002-WORKSPACE-CONFIGURATION.md)。实验允许 breaking change，不提供历史迁移或兼容读取器。

## 可运行范围

Workspace Module 与 Save 使用同一 Binding Plan 流程解析检查和重命名，校验严格记录、UUID/路径关系、显式 Host/Installation 选择、有效配置来源、文件名诊断和内容观察修订。重命名修改实体原文 `uniformName` 与文件系统名称，保留注释、布局、UUID 和引用。

尚无通用配置编辑器、历史实现、自动启动器发现、游戏启动、基于这些记录的资产绑定或 Daemon Workspace 接口。来源声明和 Adapter 偏好表达配置意图，不代表可用集成。`save store` 仍使用自身存储配置。

## 从仓库运行

```sh
just build
just cli features
just cli plan workspace.inspect
just cli plan workspace.rename
just cli workspace schema
just cli workspace inspect <workspace-root>
just cli workspace inspect <workspace-root> <host-id> <installation-id>
just cli workspace inspect <workspace-root> --adapter filesystem.workspace-configuration
just cli workspace rename <workspace-root> <record-id> <uniform-name>
just cli workspace inspect <workspace-root> --json --non-interactive
```

`just build` 转发到 `pnpm build`。`just cli` 运行已构建的 Node CLI，并把参数作为原生 argv 转发。`pnpm build` 和 `pnpm cli` 仍可供该范围和 agent 直接调用。

显式选择根目录，相对路径依据进程工作目录解析。允许用户选择根目录 projection，但拒绝配置树内部链接，不从应用仓库推断 Workspace。公开示例只用合成数据；本机检查结果可能包含私人路径。

CLI 使用 oclif 显式命令和 clack TTY 提示。无命令时显示菜单，缺失参数可补问。参数优先于 `INTERACTIVE`，环境优先于 TTY 检测。`--non-interactive`、`--interactive=false`、`INTERACTIVE=false` 禁用提示；JSON/非 TTY 执行不提示，缺失必填值时明确失败。取消提示不写入。

## 格式与记录

人工配置采用 UTF-8 TOML 1.0，机器输出、JSON Schema 与 Artifact manifest 继续采用 JSON。每个记录包含 `schemaVersion = "workspace.experimental.3"`、小写 UUIDv7 `id` 与 `kind`。Zod 模型提供运行时校验、类型与 JSON Schema。拒绝未知字段、旧标记、null、日期/时间、非有限数值及不安全整数。Adapter 选项对象保持不透明，执行前仍由所属 Extension 校验。

| kind | 公共字段之外的字段 | `.konogame/` 内路径 |
| --- | --- | --- |
| `workspace` | `name`、`defaults`、`history` | `workspace.toml` |
| `game` | `uniformName`、`title`、可选 `edition`、`externalRefs`、`settings` | `games/<id>-<name>.toml` 或 `games/<id>-<name>/game.toml` |
| `host` | `uniformName`、`label`、`platform`、`roots`、`defaults`、`gameOverrides`、`sources` | `local/<id>-<name>.toml` 或 `local/<id>-<name>/host.toml` |
| `installation` | `uniformName`、`gameId`、`hostId`、`sourceId`、`location`、`launchEntries`、`settings` | `local/<host-id>-<name>/installations/<id>-<name>.toml`，或同一 installations 目录内的 `<id>-<name>/installation.toml` |

两种布局语义相同。平铺 Host 可以拥有同名附属目录存放安装记录。UUID 是唯一身份：重复 UUID 报错，关系只引用 ID。`uniformName` 保留原文。文件系统后缀采用 NFC 与 `unicode-fs-v1`：保留 Unicode/大小写，将禁用字符、`%`、控制字符和末尾空格/句点按 UTF-8 字节编码为大写 `%HH`，不转拼音或小写。组件超过 255 UTF-8 字节或 255 UTF-16 代码单元时拒绝且不截断。后缀不一致产生诊断，不形成另一个身份。

历史明确为 `{ mode = "disabled" }` 或 `{ mode = "adapter", adapterId = "..." }`。目前不提供历史 Adapter。指定但不可用、不兼容或未激活的 Adapter 通过共享解析器报告。引导根目录及可选 `--adapter` 来自调用方；已加载配置不能决定自身加载方式。

Host `roots` 是自定义键到该 Host 平台绝对路径的映射。来源声明包含 `id`、`kind`、`status`（`planned` 或 `configured`），不含来源 roots，也不定义扫描范围。Installation `location.kind` 可以是带绝对 `path` 的 `fs.absolute`、带 `rootKey` 与相对 `path` 的 `fs.relative`，或带 `{ authority, kind, key }` 引用的 `managed`。相对路径不能越出所引用 Host 根。不预设盘符/商店库层级，不检查路径是否存在，不执行启动入口。

每个配置文件上限为 1 MiB。小型配置元数据读入内存；游戏 Artifact 继续遵守多文件流式契约。修订对排序后的配置路径和原始字节计算哈希，包括本机记录，空白编辑也改变修订。读取修订是观察令牌，不是历史 ID 或原子快照。

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

应用服务提供预期修订与操作身份。filesystem Adapter 使用锁协调应用写入器，复查修订/哈希，暂存临时内容并保留恢复数据。冲突不覆盖目标，恢复/重试仅适用于同一实体与目标。回滚失败明确报告需要恢复。任意外部编辑器不共享此锁，因此流程不承诺对其提供原子 compare-and-swap。恢复数据不等于历史或通用事务系统。可选历史不影响基本检查和重命名。

合成夹具覆盖 Schema 拒绝、双布局、Unicode 文件名编码和限制、根/位置、分层清除、过期修订、冲突、注释保留与恢复路径。私人观察、账号标识、真实路径及游戏清单保留在公开夹具和文档之外。更广泛编辑、发现录入和可选 Git 历史属于[后续增量](roadmap/001-INITIAL-ITERATIONS.md)。

[English](../en/002-WORKSPACE-EXPERIMENT.md) | [中文](002-WORKSPACE-EXPERIMENT.md)
