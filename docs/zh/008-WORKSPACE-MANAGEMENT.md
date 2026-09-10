# 08 Workspace 管理与游戏库维护

状态：当前本机原型，2026-10-18。[ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md)记录决策；[实验指南](002-WORKSPACE-EXPERIMENT.md)说明记录布局与发现/录入。以下命令使用合成路径和 ID，先运行 `just build`。

## 从已有目录初始化

显式选择已存在目录；Konogame 不递归创建用户目录，也不接管已有 `.konogame`，即使配置目录为空。

```sh
just cli workspace init C:/Synthetic/Library --name "Sample Library" --host-name "Sample PC" --platform windows --yes --json
```

`--platform` 接受 `windows`、`linux`、`macos`；可选 `--host-label` 设置初始展示标签，默认采用 `--host-name`。`--adapter` 选择配置 Adapter，`--operation-id` 可提供用于恢复的稳定 UUIDv7。初始化创建不同的 Workspace/Host UUIDv7 身份、空 defaults/roots/sources/Host overrides，并禁用历史；不依赖 Git 或 Daemon。

所选根内生成 `.konogame/workspace.toml`、目录布局 Host `.konogame/local/<host-key>/host.toml`，以及排除 `/local/`、`/cache/`、`/recovery/` 的 `.konogame/.gitignore`，不修改用户根 `.gitignore`。来源声明和游戏记录通过各自流程增加。

初始化以独占 mkdir 预留 `.konogame`，暂存有限文件集，再逐文件不覆盖发布，`workspace.toml` 最后发布；这不是原子目录发布或多文件事务。出现 `recovery-required` 时保留 operation ID 并使用：

```sh
just cli workspace recover-initialize C:/Synthetic/Library <operation-id> --yes --json
```

恢复只依据本笔 journal/receipt 完成已批准初始化，并核查已有内容。已有/不完整目录若没有有效 journal，需要人工检查；恢复不虚构新操作，也不覆盖冲突字节。

## 单次变更先审核再应用

新增 Host 默认只读预览，新 Host 使用目录布局；显式 `--apply --yes` 可在同次调用中应用重建的预览。

```sh
just cli workspace host add C:/Synthetic/Library "Second PC" --platform windows --json > C:/Synthetic/host-preview.json
just cli workspace edit apply C:/Synthetic/Library C:/Synthetic/host-preview.json --yes --json
```

已有记录每次选择一种变更类别：

```sh
just cli workspace edit preview C:/Synthetic/Library --record-id <game-id> --title "Sample Game" --json > C:/Synthetic/edit-preview.json
just cli workspace edit apply C:/Synthetic/Library C:/Synthetic/edit-preview.json --yes --json
```

CLI 单独 `--title` 保留当前 edition，`--edition` 修改它，`--unset-edition` 显式删除。Workspace 展示名用 `--name`，Host 展示标签用 `--label`；这些不改变 `uniformName`，统一名与文件名继续使用已有 `workspace rename` 流程。

严格 `workspace-edit-preview.1` 包含 root、Workspace ID、预期原始修订、operation ID、配置 Adapter ID、变更、语义差异、read/apply Binding Plan 和摘要。预览只读计算，不修改配置；只读配置 Adapter 可以预览，同时报告 apply 不可用。Apply 严格解析预览，独立检查调用方所选 root，重读 Workspace 并重建完整审核后才写入。字节/修订/绑定改变或预览被修改时需重新审核。摘要用于变更检测，不是授权签名；即使 unchanged apply 也需要新鲜预览与显式确认。

## 支持的意图

每笔编辑以严格意图影响一个记录，不接受任意 TOML 路径或提交的替换记录。UUID、`uniformName`、关系、Location、外部引用和启动入口不在可编辑元数据投影中。

| 意图 | 支持的变更 |
| --- | --- |
| `metadata.replace` | Workspace name、Game title/可选 edition、Host label；原始 Game 投影必须带 title，省略 edition 表示删除。 |
| `settings.replace` | 完整替换一个持久 Workspace/Game/Host/Installation 层，或 Host 记录中的 Host/Game override。 |
| `host.create` | 创建经过校验、具有独立 UUID 的 Host。 |
| `host.roots.replace` | 替换一个 Host 的 roots 上下文。 |
| `host.sources.replace` | 替换一个 Host 的来源声明。 |

`--change-file` 接收严格 JSON 意图，与便捷变更参数互斥。例如来源声明文件可包含：

```json
{
  "kind": "host.sources.replace",
  "hostId": "01900000-0000-7000-8000-000000000002",
  "sources": [
    { "id": "loose", "kind": "standalone", "status": "configured" }
  ]
}
```

```sh
just cli workspace edit preview C:/Synthetic/Library --change-file C:/Synthetic/source-change.json --json
```

便捷参数 `--host-id` 配合可重复 `--root-set alias=value`/`--root-remove alias`，或可重复 `--source-set id:kind:status`/`--source-remove id`，从当前值构造变更并保留其他键/声明。已有安装引用的 source 不能删除或改变 kind；允许将 status 降回 `planned`，保留引用并在游戏库查询中显示。Roots 只是 Adapter 上下文，不授予扫描范围，source kind 不是 Adapter ID。

## 明确替换设置层

使用 `--kind workspace|game|host|host-game|installation` 与 `--record-id` 选择层；Host/Game 另需 `--game-id`。`--settings-json` 完整替换该层，较小的 `--arguments-json`、可重复 `--preferred-adapter Feature=Adapter` 和 `--clear-preferred-adapter Feature` 先保留其他设置，再生成完整意图；完整替换 JSON 不与这些小参数混用。

| 替换中的值 | 含义 |
| --- | --- |
| 省略某设置 | 删除本层值，恢复从之前层继承。 |
| `clear` | 显式清除选定继承标量/映射项，同层 set/clear 冲突无效。 |
| `arguments: []` | 显式空参数数组。 |
| Host/Game `settings: {}` | 删除该 override，恢复继承。 |

内置层和调用覆盖层不持久化，数组整体替换，Adapter options 按 Adapter 整个对象替换。普通设置校验不证明不透明 Adapter 选项可执行。配置值拒绝 null、日期/时间、非有限数值和不安全整数。

## 查询游戏库并解释设置

```sh
just cli game list C:/Synthetic/Library --json
just cli game list C:/Synthetic/Library --host-id <host-id> --source-id loose --json
just cli game show C:/Synthetic/Library <game-id> --json
just cli workspace explain C:/Synthetic/Library --installation-id <installation-id> --feature save.store --json
```

List/show 关联 Game、安装、Host/source 声明、原始 Location 和校验/可用性；来源过滤要求选择 Host，未知 Location 类型仍可读取并明确不可用。这不启动游戏，也不认证资源存在。Explain 返回七层、有效值/来源、显式清除与逐 Feature 绑定可用性/原因；仅指定安装的 explain 会推导所属 Host，显式矛盾选择会被拒绝，旧 inspect 选择契约不变。位置状态独立报告，不附加为通用 Feature 绑定限制，因此未知 Location 不阻断 Artifact 存储或元数据编辑。选择还可使用 `--game-id`/`--host-id`，`--overrides-json` 提供不持久化调用层。`--feature` 可重复，`--adapter` 选择配置读取；评估绑定可能激活兼容 Extension，但不执行所选资产操作。

## 持久化与恢复限制

核心配置通过 `workspace.configuration` 的 `initialize`、`recover-initialize`、`edit`、`recover-edit` Operation 拥有这些算法，对应 Capability 为 `configuration.initialize`、`configuration.initialize-recovery`、`configuration.edit`、`configuration.edit-recovery`；已有 read/rename/import/recovery 继续区分。Workspace 审核见 [management.ts](../../packages/workspace/src/management.ts)，[领域编辑计划](../../packages/workspace/src/index.ts)重建有效记录，[持久化](../../packages/workspace-configuration/src/workspace-management.ts)和 [TOML token 编辑](../../packages/workspace-configuration/src/toml-edit.ts)负责 I/O 与原文保留。

编辑通过 AST token 修改保留未触及字节/注释、换行风格及已有平铺/目录布局；删除受影响 table token 时保留独立注释，变更字段可采用新格式。记录仍限制为 1 MiB UTF-8，管理 journal 上限 16 MiB。已接受的 unchanged 保留记录字节，但消费 operation ID，可能写入协调 receipt、准备恢复目录及取得/释放写锁。同一请求重试返回 unchanged，同 operation ID 换用不同 payload 或 revision 则冲突，不承诺零文件系统写入。同父目录短暂存名支持达到已有长度上限的合法记录文件名组件，不放宽已有文件名限制。

初始化/编辑与 rename/import 共享写入协调，并受未完成操作阻止。定向 edit journal 记录意图、before/after 内容及原始修订/哈希；已有记录在最终内容检查后执行单文件替换，新 Host 独占发布。外部编辑器不共享锁，不能消除最后检查/替换瞬间的竞争；外部改动使恢复停止，不被覆盖。

```sh
just cli workspace edit recover C:/Synthetic/Library <operation-id> --yes --json
```

恢复只处理已批准元数据，不执行 Location 资源，也不依赖历史；不自动重试旧预览，不提供通用回滚/事务。JSON/非 TTY 写入及恢复需要 `--yes`，TTY 确认可取消且不写入，init 取消发生在运行时构建前。任意编辑、删除、修改安装身份/Location、启动、Git 历史与资产备份/恢复仍在本轮之外。Workspace Schema 4 和 core/Extension 版本不变。公开示例/测试保持合成，私人 Workspace 验证仅在实际核查后记录脱敏实现结果。

## Effect 执行与中断

配置 Port 与 I/O 现在通过 owner Layer 返回类型化 Effect；Scope 拥有 writer 锁/句柄，仅释放已获取资源。Preview 仍只读，apply/recovery 保持本文的 root/revision/evidence 与批准元数据检查。中断保持 Interrupt，保留恢复材料并查看结构化 stderr 日志中的 recovery-required。最小原生发布可能在观察到中断前完成。清理预算是协作式的，Effect 4.0.6 嵌套 bracket 中断可能使外层 Cause 遗漏附加 finalizer 失败。参见[生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)与 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。Schema 4 和发布版本不变。

[English](../en/008-WORKSPACE-MANAGEMENT.md) | [中文](008-WORKSPACE-MANAGEMENT.md)
