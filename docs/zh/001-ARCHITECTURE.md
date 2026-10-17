# 01 当前架构

状态：目前包含初始契约、filesystem 存储与 TOML Workspace 检查/重命名原型，尚非完整游戏管理器。

## 概念与调用链

| 概念 | 含义 |
| --- | --- |
| Module | 负责资产或 Workspace 管理等领域，组织用户可见的 Feature。 |
| Feature | 用户请求的任务，例如 `save.store`、`save.history`。 |
| Port/Contract | 可替换、独立版本化的输入输出边界。 |
| Operation | Port 上的动作，例如 `put`、`open`、`list`。 |
| Capability | Adapter 的细粒度性质，例如 `artifact.streaming`、`history.versioned`。 |
| Extension | 可独立分发的包，可提供多个 Adapter。 |
| Adapter | Extension 对一个 Port 的实现，声明 Operation 与 Capability。 |
| Binding Plan | 能力协商和 Adapter 解析的结果，含绑定与不可满足的请求。 |

调用链为 `CLI / Daemon -> 应用服务 -> Feature -> Port Operation -> 已解析的 Adapter`。CLI 和 Daemon 组装同一应用服务。一个 Extension 可为多个 Module 提供 Adapter；Module 不导入厂商实现。解析时检查契约版本、Operation 和全部必需 Capability。用户明确指定的 Adapter 不兼容时要报错，不能悄悄回退。实际 Contract 协议为 `0.1.0`；Module 与 Adapter 用 SemVer `contractRange` 声明兼容范围。Core 可执行程序/包统一发行版本 `0.1.0-alpha.0`，每个 Extension 独立版本并声明对应软件兼容性。动态发现留待后续。详见 [ADR 0003](adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) 和[发布维护](003-RELEASE-MAINTENANCE.md)。

Provider 只描述 Adapter 或已配置 Adapter 实例提供实现的角色，不是另一种扩展类型、注册表或契约体系。Game、Host、Installation 是实体，其记录不需要各自建立 Module 或 Provider。

有限值集合使用 `const X = { ... } as const` 和 `type X = (typeof X)[keyof typeof X]`，Schema 与判别字段复用常量，不使用 TypeScript enum 或单独的字面量联合声明。

## Artifact 与基础设施

Artifact 对其他 Module 不透明：包含媒体类型、元数据和异步枚举的文件；每个文件按需打开字节流。消费者不能假定它是单个压缩包、必须整体载入内存，或依赖另一个 Module 内的路径。Artifact 路径使用安全的相对名称。新增 Artifact ID 使用小写 UUIDv7，manifest 保持机器 JSON。filesystem Adapter 把清单和流式副本写入新目录，不提供历史版本接口。

通用基础设施 Port 包括 `BlobPort`（字节）、`SnapshotPort`（时间点引用）、`ReplicationPort`（异地复制）。它们不等同用户侧 Feature，目前只有接口。Module 可以按需使用，不要求每个 Adapter 全部支持。

## 首个 Module：Save

Save 首批定义六个 Port/Feature：`save.discover`、`save.export`、`save.import`、`save.convert`、`save.store`、`save.history`。Store 有 `put`、`open` Operation；History 有 `list`，要求 `history.versioned`。filesystem 当前只实现 `save.store`。其余 Port 是集成边界，还不是可运行命令。历史版本可选。

## Workspace 配置实验

`packages/workspace` 定义 Workspace Module、契约、严格实验记录和纯覆盖规则。`packages/application` 通过与 Save 相同的 `resolveBindings` 流程解析 Feature，调用已注册实现并检查有效值。CLI 与 Daemon 共享组装；Daemon 提供计划查询，CLI 还可执行 Workspace 检查和实体重命名。

| Feature | Port / Operation | 必需 Capability | 当前实现 |
| --- | --- | --- | --- |
| `workspace.inspect` | `workspace.configuration` / `read` | `configuration.records` | filesystem Extension 提供的 `filesystem.workspace-configuration`。 |
| `workspace.rename` | `workspace.configuration` / `rename` | `configuration.rename` | `filesystem.workspace-configuration` 的专用重命名与恢复流程。 |
| `workspace.history` | `workspace.history` / `list` | `history.versioned` | 尚未提供历史 Adapter。 |

配置 I/O 之前检查契约版本、Operation、Capability 和显式偏好。检查结果返回选中的 Binding Plan。描述兼容与运行实例存在是两个条件，缺少实例不能执行。历史可用性也使用相同解析器并检查运行实例注册表，不自动执行历史操作。

启动所需的根目录和可选配置 Adapter 偏好来自调用者，不能依赖尚未读取的配置文件。Schema 导出、纯校验与覆盖计算不需要替换实现，保持普通函数。`adapterOptions` 保存 Adapter 配置，`history.mode` 禁用历史或在 adapter 模式要求 `adapterId`，来源 `kind` 表示启动器等开放来源类别，不是 Adapter。

可携带的 Game 记录与本机 Host/Installation 记录分开。Schema 变化允许破坏实验文件，不提供历史 migration 或兼容读取器。人工配置采用 TOML 1.0、实验 Schema 3 和 JSON 共通值子集，不接受 null、日期/时间、非有限数值或不安全整数。机器输出、JSON Schema 与 Artifact manifest 保持 JSON。小写 UUIDv7 是唯一身份；Game/Host/Installation 保留原文 `uniformName`，使用版本化 `unicode-fs-v1` NFC/百分号文件名编码，支持等价平铺/目录布局。配置显式清除取代可空设置。Host roots 是任意本机绝对路径别名；Installation 位置为 `fs.absolute`、`fs.relative` 或 `managed`，来源声明不定义扫描根。

重命名保留注释、未改动 TOML、布局、UUID 和引用，通过锁、修订/哈希检查、临时内容和恢复状态协调写入器，冲突不覆盖，回滚失败需要恢复。同一实体/目标重试不构成通用事务系统，也不提供针对任意外部编辑器的原子保护。通用编辑、配置历史、发现、启动及使用配置执行资产操作仍待实现。[ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md) 记录这些决策。参见[已实现范围](002-WORKSPACE-EXPERIMENT.md)和[推荐方案](roadmap/002-WORKSPACE-CONFIGURATION.md)。

## 入口与构建

Node 26 ESM 入口导出函数，仅在 `import.meta.main` 时执行，导入不启动进程。按需使用 `import.meta.dirname`/`import.meta.filename`，不重建对应路径。`@konogame/local-runtime`（`apps/shared/src/index.ts`）组装共享依赖。各包通过 tsdown 非打包构建独立 JavaScript/声明文件，导出指向 `dist` 产物。dev-cli 是 `scripts/dev-cli/src/main.ts` 所在 workspace。测试使用 Vitest。日常命令从 `just` 进入，并转发给负责该范围的工具：`just check` 转发到 `pnpm check`，执行 Biome、构建、类型检查、测试、文档检查和发布 metadata 校验。pnpm、Node，以及以后的 Cargo、uv，继续提供各自范围内的命令，agent 也可以直接调用。

CLI 使用 oclif 显式命令与 clack TTY 辅助。无命令菜单和缺参提示遵循参数 > 环境 > TTY。`--non-interactive`、`--interactive=false`、`INTERACTIVE=false` 禁用提示；JSON/非 TTY 执行不提示，取消不写入。

TypeScript 项目共享 `tsconfig.base.json`，各 workspace 通过独立配置与 references 声明依赖。根 solution 引用这些项目，以及独立的测试和构建工具项目。`customConditions: ["monorepo-tsc"]` 选择 workspace exports 中位于 `types`/`import` 之前的源码入口，使编辑器无需等待包构建即可解析源码。普通运行时继续使用 `dist`。`just typecheck` 转发到 `pnpm typecheck`，后者使用 `tsc --build`；声明映射和增量产物写入已忽略的 `dist-tsc/`，与 tsdown 产物分别存放。 根目录和各 workspace 的 `tsconfig.json` 仅引用适用的 `tsconfig.app.json`、`tsconfig.lib.json`、`tsconfig.tool.json` 与 `tsconfig.test.json` 项目。每个包拥有独立测试项目，显式引用生产依赖，生产构建排除测试。Vitest 分组运行源码同级 `__tests__/*.test.ts` 单元测试、包内 `tests/integration/*.test.ts` 集成测试，以及包内或仓库级 `tests/e2e/*.test.ts` 端到端测试；可用 `just test --project unit`、`integration` 或 `e2e` 单独运行一组。

## 集成职责

- **Ludusavi**：未来用于存档发现、导出、导入的 Adapter，而不是存储层。
- **Kopia**：未来可供 Save、Patch 等 Module 共享的 snapshot/blob 基础设施 Adapter；版本化仍是可选能力。
- **OpenDAL**：未来的存储/复制 Adapter 与后端配置映射；core 不解释厂商特有配置。
- **Trilium**：未来用于攻略、笔记、成就日志的 Module 集成。
- **Syncthing / Rclone / RustFS**：处于复制与存储下层。Syncthing 可同步文件系统副本，Rclone 可连接远端，RustFS 可提供 S3 端点；它们不是 Save Module API。

早期设计作为[历史草案存档](archive/README.md)保留。Windows 挂载、UI、启动编排、外部进程协议和持久化策略需要另行决策。

[English](../en/001-ARCHITECTURE.md) | [中文](001-ARCHITECTURE.md)
