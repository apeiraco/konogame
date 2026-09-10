# ADR 0008：Workspace 管理与游戏库维护

状态：于 2026-10-18 采纳。扩展 [ADR 0002](0002-WORKSPACE-TOML-AND-TOOLING.md)的有限元数据流程，保留 [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)的位置和核心持久化归属。准确命令见[管理指南](../008-WORKSPACE-MANAGEMENT.md)。

## 决策

已有 Workspace 配置 Port 增加 `initialize`、`recover-initialize`、`edit`、`recover-edit`，使用各自匹配的 Feature/Capability。领域 `applyConfigurationEdit` 通过显式 `metadata.replace`、`settings.replace`、`host.create`、`host.roots.replace`、`host.sources.replace` 意图计算有效单记录与语义差异。应用管理协调绑定及审核，核心配置拥有 TOML/I/O/journal，CLI 处理参数、确认及呈现，不引入新 Provider 注册表或任意 patch 系统。

初始化只接受调用方显式选择的已有根，独占预留 `.konogame`，暂存固定有界文件集，不覆盖发布 `.gitignore` 和目录布局初始 Host，最后发布 `workspace.toml`。历史禁用，Workspace/Host UUIDv7 不同，由应用提供；Host defaults/roots/sources/overrides 初始为空。`.konogame/.gitignore` 排除 local/cache/recovery，不改根 ignore 文件。Journal 与 operation receipt 支持定向恢复，已有配置目录冲突，缺少恢复证据时需人工检查。不通过目录 rename 宣称跨平台无覆盖原子初始化。

编辑预览是严格 `workspace-edit-preview.1` 值，包含 root/Workspace 身份、预期原始修订、操作身份、Adapter 身份、意图、差异、read/apply 计划与摘要。预览只读，配置 Adapter 只读且不能 apply 时仍可预览。Apply 独立锚定调用方 root，严格校验预览，重读并重建审核，解析写入能力后才持久化。摘要只检测变化，不是认证授权签名；旧审核需新预览，不承诺自动重放。

元数据投影只编辑 Workspace name、Game title/edition、Host label，UUID、uniformName、关系、Location、外部引用和启动入口不在投影中。UniformName 使用 rename。原始 Game 元数据替换省略 edition 表示删除；CLI title-only 保留 edition，显式 unset 才删除。Settings 完整替换一个持久层：省略继承，clear 显式清除继承选择，空 arguments 数组是明确值。空 Host/Game settings 删除 override；便捷参数可在构造完整意图时保留当前无关值。内置/调用层不持久化。

Host source 删除或 kind 改变不能破坏 Installation 引用，status 可降回 planned 且保留引用。Roots 仍是 Adapter 上下文，不授予扫描权限，core 不解释路径。游戏库 list/show 关联实体、Host/source 声明与原始 Location 可用性。Settings explain 返回七层、有效值/来源、显式清除和逐 Feature 兼容性，评估绑定不执行资产操作。Explain 可从仅安装选择推导 Host，并拒绝显式矛盾；位置状态独立于通用 Feature 绑定，未知 Location 不禁用 Artifact 存储或元数据编辑，旧 inspect 选择契约不变。

初始化/编辑与 rename/import 共享写入协调及未完成操作门禁。AST 范围编辑保留无关 TOML 字节/注释、换行风格与已有布局；记录上限仍为 1 MiB UTF-8，管理 journal 为 16 MiB。已有记录最终内容检查后执行单文件替换，新 Host 文件独占发布。定向 edit journal/receipt 校验意图、before/after 内容、修订与哈希，以前向完成本笔操作。最后检查/替换之间仍可能出现外部编辑器竞争，外部变化使恢复停止；这不是通用事务或任意回滚。元数据编辑/恢复不执行 Location 资源，不依赖位置注册/历史。已接受的 unchanged 保留记录字节但消费操作身份，可能写协调 receipt；同请求可重试 unchanged，同操作 ID 换用不同 payload/revision 则冲突，协调/恢复文件仍可能被触及。

## 影响与范围

用户可初始化、声明 Host/source、发现及录入游戏、查询游戏库、审核有限编辑并解释其影响，无需手写全部记录或依赖 Git/Daemon。JSON/非 TTY 写入需显式确认，取消不写入。Schema 4 和发行版本不变，不增迁移垫层，公开示例不含私人数据。任意编辑/删除、安装身份/Location 变更、启动、配置历史及资产备份/恢复仍属后续工作，需各自审核与恢复契约。

[English](../../en/adr/0008-WORKSPACE-MANAGEMENT.md) | [中文](0008-WORKSPACE-MANAGEMENT.md)
