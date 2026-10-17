# ADR 0002：Workspace TOML、身份、重命名与运行工具

状态：于 2026-10-17 为本地实验采纳。本文取代原 Workspace 提案中 JSON、null 与只读范围的建议，不承诺稳定的外部 Schema。

## 背景

Workspace 文件需要可读名称、注释、可移植身份和范围明确的安全编辑流程。CLI 需要显式命令与交互辅助，包需要可导入入口和可重现的构建产物。文件系统操作不依赖历史或 Daemon。

## 配置与身份

人工维护的配置采用 TOML 1.0，Schema 标记为 `workspace.experimental.3`。机器输出、JSON Schema 与 Artifact manifest 继续采用 JSON。单一 Zod 记录模型提供校验、类型和 JSON Schema。配置值仅允许 TOML/JSON 共通子集：字符串、布尔值、有限数值（整数必须安全）、数组和对象。拒绝 null、日期/时间、非有限数值和不安全整数，不做隐式转换。

省略设置表示继承，数组整体替换，Adapter 选项按 Adapter 整个对象替换。显式清除采用 `settings.clear = { launchEntry?: true, preferredAdapters?: string[], adapterOptions?: string[] }`；同一层不能同时设置与清除同一字段或映射键。`history` 为 `{ mode = "disabled" }` 或 `{ mode = "adapter", adapterId = "..." }`。有效配置的机器输出可以用 null 表达清除；TOML 配置中没有 null 值。

新增 Workspace、Game、Host、Installation 与 Artifact 使用小写 UUIDv7。实验记录可以经过明确操作重建，不增加旧版本读取器或迁移层。发现不兼容记录时报告并保留用户数据。UUID 是唯一身份，所有引用只使用 UUID，名称及文件名后缀不参与引用。

Game、Host、Installation 在 title/label 等展示字段之外保留原文 `uniformName`。版本化文件名编码 `unicode-fs-v1` 对文件系统后缀执行 NFC 规范化，保留 Unicode 和大小写，将文件系统禁用字符、`%`、控制字符及末尾空格/句点按 UTF-8 字节编码为大写 `%HH`。不转小写，不转拼音。文件名组件超过 255 UTF-8 字节或 255 UTF-16 代码单元时拒绝，不截断。记录内部保留原文。

每个实体可以采用 `<uuid>-<encoded-name>.toml` 或 `<uuid>-<encoded-name>/<kind>.toml`。两种布局语义相同，重复 UUID 报错，名称后缀不一致产生诊断。`.konogame/workspace.toml` 保持固定。平铺 Host 可以附带同名目录存放 `installations/`；重命名 Host 时一并移动该容器。

Installation 位置默认采用带 `path` 的 `fs.absolute`，也可采用带 `rootKey`、`path` 的 `fs.relative`，或带类型化外部引用的 `managed`。Host `roots` 把用户自定义键映射到绝对路径，不预设启动器库、盘符或平台分类。相对位置依据所属 Host 解析，不能越出选定根。来源声明保留 `id`、`kind` 与状态，移除 `sources[].roots`。未来发现范围需要独立显式模型。

## 重命名边界与恢复

`workspace.rename` 使用已有 `workspace.configuration` Port、`rename` Operation 和 `configuration.rename` Capability。应用服务在 I/O 前解析 Binding Plan。专用流程修改 `uniformName` 与记录文件/目录名，保留注释、未修改原文、布局、UUID 和 UUID 引用。展示 title/label 独立于该名称。固定的 Workspace 文件不属于实体重命名目标。

filesystem 流程使用写入锁协调应用写入器，检查预期观察修订与文件哈希，暂存临时内容、保留恢复信息，再明确移动记录路径。冲突不覆盖目标，回滚失败明确报告需要恢复。重试/恢复限定同一实体和目标，并通过操作身份识别重试。这些保证不能让任意外部编辑器参与原子 compare-and-swap。专用重命名流程不扩展成通用多文件事务引擎。历史是独立可选结果，重命名不依赖历史。

## CLI 与包工具

显式 CLI 命令使用 `@oclif/core`，TTY 辅助使用 `@clack/prompts`。无命令时显示菜单，缺失参数可交互补问。`--non-interactive`、`--interactive=false`、`INTERACTIVE=false` 禁用提示；优先级为参数、环境、TTY 检测。JSON 与非 TTY 执行不提示，取消不写入。命令为 `workspace rename <root> <id> <name>`。

Node 26 ESM 入口导出可调用函数，仅在 `import.meta.main` 时运行，导入不产生启动副作用。按需使用 `import.meta.dirname` 和 `import.meta.filename`。每个 workspace 包通过 tsdown 非打包构建自己的 `dist` JavaScript 与声明文件，包导出指向构建产物。`apps/shared/src/index.ts` 是 `@konogame/local-runtime` 的入口；仓库工具迁至 `scripts/dev-cli` workspace，其入口为 `src/main.ts`。测试使用 Vitest。日常命令从 `just` 进入。先通过 `just build` 生成产物；`just check` 转发到 `pnpm check`，执行构建、类型检查、测试和文档检查。pnpm 和 Node 仍可供各自范围和 agent 直接调用。

## 影响

TOML 编辑和文件系统命名需要覆盖往返、冲突、恢复、Unicode 与两种布局的聚焦测试。CLI、Daemon、dev-cli 执行前需要构建。更广泛编辑、发现录入、Git 历史、启动语义和图形界面继续独立推进。当前范围见[实验](../002-WORKSPACE-EXPERIMENT.md)，后续工作见[路线图](../roadmap/001-INITIAL-ITERATIONS.md)。

[English](../../en/adr/0002-WORKSPACE-TOML-AND-TOOLING.md) | [中文](0002-WORKSPACE-TOML-AND-TOOLING.md)
