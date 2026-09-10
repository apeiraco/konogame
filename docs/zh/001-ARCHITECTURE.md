# 01 当前架构

状态：目前包含初始契约、filesystem 存储、TOML Workspace 初始化、审核编辑、检查/重命名与本地发现/录入原型，尚非完整游戏管理器。

## 概念与调用链

| 概念 | 含义 |
| --- | --- |
| Module | 负责资产或 Workspace 管理等领域，组织用户可见的 Feature。 |
| Feature | 用户请求的任务，例如 `save.store`、`save.history`。 |
| Port/Contract | 可替换、独立版本化的输入输出边界。 |
| Operation | Port 上的动作，例如 `put`、`open`、`list`。 |
| Capability | Adapter 的细粒度性质，例如 `artifact.streaming`、`history.versioned`。 |
| Extension | 可独立分发的包，可提供多个 Adapter。 |
| Adapter | Module 或 Extension 对一个 Port 的实现，声明 Operation 与 Capability。 |
| Binding Plan | 能力协商和 Adapter 解析的结果，含绑定与不可满足的请求。 |

调用链为 `CLI / Daemon -> 应用服务 -> Feature -> Port Operation -> 已解析的 Adapter`。CLI 和 Daemon 组装同一应用服务。一个 Extension 可为多个 Module 提供 Adapter；Module 不导入厂商实现。解析时检查契约版本、Operation 和全部必需 Capability。用户明确指定的 Adapter 不兼容时要报错，不能悄悄回退。实际 Contract 协议为 `0.2.0`；Module 与 Adapter 用 SemVer `contractRange` 声明兼容范围。Core 可执行程序/包统一发行版本 `0.1.0-alpha.0`，每个 Extension 独立版本并声明对应软件兼容性。内置/注入 source 已支持惰性运行加载与目录管理；显式根 Node 安装发现已可用；marketplace/下载及独立 host 隔离尚未实现。详见 [ADR 0003](adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md) 和[发布维护](003-RELEASE-MAINTENANCE.md)。

Provider 只描述 Adapter 或已配置 Adapter 实例提供实现的角色，不是另一种扩展类型、注册表或契约体系。Game、Host、Installation 是实体，其记录不需要各自建立 Module 或 Provider。

有限值集合使用 `const X = { ... } as const` 和 `type X = (typeof X)[keyof typeof X]`，Schema 与判别字段复用常量，不使用 TypeScript enum 或单独的字面量联合声明。

边界校验接受 Standard Schema 或 JSON Schema 文档，并用 arktype 执行。离开进程的 Schema，包括 Location `dataSchema` 和导出的 Workspace JSON Schema，以 JSON Schema 传输。`@ark/json-schema` 把 JSON Schema 转成 arktype，arktype 的 `toJsonSchema` 转回 JSON Schema。可序列化的 Workspace 记录只使用能够一对一转换的约束。配置值的数字边界来自 JSON Schema，其余为字符串、布尔、数组和对象。

## Artifact 与基础设施

Artifact 对其他 Module 不透明：包含媒体类型、元数据和文件 Stream；每个文件按需打开字节 Stream，句柄归 Scope。消费者不能假定它是单个压缩包、必须整体载入内存，或依赖另一个 Module 内的路径。Artifact 路径使用安全的相对名称。新增 Artifact ID 使用小写 UUIDv7，manifest 保持机器 JSON。filesystem Adapter 把清单和流式副本写入新目录，不提供历史版本接口。

通用基础设施 Port 包括 `BlobPort`（字节）、`SnapshotPort`（时间点引用）、`ReplicationPort`（异地复制）。它们不等同用户侧 Feature，目前只有接口。Module 可以按需使用，不要求每个 Adapter 全部支持。

## 首个 Module：Save

Save 首批定义六个 Port/Feature：`save.discover`、`save.export`、`save.import`、`save.convert`、`save.store`、`save.history`。Store 有 `put`、`open` Operation；History 有 `list`，要求 `history.versioned`。filesystem 当前只实现 `save.store`。其余 Port 是集成边界，还不是可运行命令。历史版本可选。

## Workspace 配置实验

`packages/workspace` 定义 Workspace Module、契约、严格实验记录、纯覆盖规则，以及检查和编辑用例。`packages/game` 负责发现准入，可以依赖 `workspace`。CLI 与 Daemon 各自合并所需的所有者 Layer。Daemon 提供计划查询，CLI 还可执行 Workspace 检查和实体重命名。

| Feature | Port / Operation | 必需 Capability | 当前实现 |
| --- | --- | --- | --- |
| `workspace.inspect` | `workspace.configuration` / `read` | `configuration.records` | Module `konogame.workspace` 所属的 `core.workspace-configuration`。 |
| `workspace.rename` | `workspace.configuration` / `rename` | `configuration.rename` | `core.workspace-configuration` 的专用重命名与恢复流程。 |
| `workspace.import` | `workspace.configuration` / `import` | `configuration.import` | 所选 Game/Installation 追加录入，保留本机 journal。 |
| `workspace.recover-import` | `workspace.configuration` / `recover-import` | `configuration.import-recovery` | 显式前向恢复已有导入操作。 |
| `workspace.initialize` | `workspace.configuration` / `initialize` | `configuration.initialize` | 已有根初始化，workspace.toml 最后发布。 |
| `workspace.recover-initialize` | `workspace.configuration` / `recover-initialize` | `configuration.initialize-recovery` | 完成已批准初始化。 |
| `workspace.edit` | `workspace.configuration` / `edit` | `configuration.edit` | 审核后的严格单记录意图。 |
| `workspace.recover-edit` | `workspace.configuration` / `recover-edit` | `configuration.edit-recovery` | 完成已批准编辑。 |
| `workspace.history` | `workspace.history` / `list` | `history.versioned` | 尚未提供历史 Adapter。 |

配置 I/O 之前检查契约版本、Operation、Capability 和显式偏好。检查结果返回选中的 Binding Plan。描述兼容与运行实例存在是两个条件，缺少实例不能执行。历史可用性使用相同绑定流程，按需激活兼容实现，不执行历史操作。

启动所需的根目录和可选配置 Adapter 偏好来自调用者，不能依赖尚未读取的配置文件。Schema 导出、纯校验与覆盖计算不需要替换实现，保持普通函数。`adapterOptions` 保存 Adapter 配置，`history.mode` 禁用历史或在 adapter 模式要求 `adapterId`，来源 `kind` 表示启动器等开放来源类别，不是 Adapter。

可携带的 Game 记录与本机 Host/Installation 记录分开。Schema 变化允许破坏实验文件，不提供历史 migration 或兼容读取器。人工配置采用 TOML 1.0、实验 Schema 4 和 JSON 共通值子集，不接受 null、日期/时间、非有限数值或不安全整数。机器输出、JSON Schema 与 Artifact manifest 保持 JSON。小写 UUIDv7 是唯一身份；Game/Host/Installation 保留原文 `uniformName`，使用版本化 `unicode-fs-v1` NFC/百分号文件名编码，支持等价平铺/目录布局。配置显式清除取代可空设置。Host roots 作为上下文传给相关 Adapter，core 不解释文件系统路径。Installation 只持有 `{ type, schemaVersion, data }`，来源声明不定义扫描根。

重命名保留注释、未改动 TOML、布局、UUID 和引用，通过锁、修订/哈希检查、临时内容和恢复状态协调写入器，冲突不覆盖，回滚失败需要恢复。同一实体/目标重试不构成通用事务系统，也不提供针对任意外部编辑器的原子保护。通用编辑、配置历史、启动及使用配置执行资产操作仍待实现。[ADR 0002](adr/0002-WORKSPACE-TOML-AND-TOOLING.md) 记录这些决策。参见[已实现范围](002-WORKSPACE-EXPERIMENT.md)和[推荐方案](roadmap/002-WORKSPACE-CONFIGURATION.md)。

## Game 发现与录入

`@konogame/game` 是共享版本 `0.1.0-alpha.0` 的 core Module。`game.discover` 绑定 `game.discovery/discover`，要求 `discovery.local`、`discovery.scoped` 与配置来源 Capability。`filesystem.game-discovery` 处理散装目录；独立版本 `konogame.steam@0.1.0-alpha.0` 提供 `steam.game-discovery`，软件兼容 `steam = "generic"` 基于合成夹具。应用组装使用 owner Context.Service tag 与原生 Effect Layer，服务构建不替代能力协商。

应用服务要求已有 configured Host/source、显式范围、只读预览和选择确认。Host roots、来源声明、库引用不扩大扫描。可靠 Steam App ID 可复用 Game 身份，名称不能合并实体。目录候选仍为弱观察，新增安装的 `launchEntries` 为空。确认严格校验不可信预览、独立锚定 root，重查修订、证据和绑定。摘要用于变更检测，不认证签名，无 TTL。新预览重复录入可返回 unchanged，成功消费的旧预览重放会过期。

`workspace.import` 使用 `workspace.configuration/import` 与 `configuration.import`；`workspace.recover-import` 使用 `recover-import` 与 `configuration.import-recovery`。核心配置录入共享重命名写锁，保留已有记录字节/布局，保留 journal 以显式前向恢复部分创建。跨文件联合写入不原子，外部修改使恢复停止。不提供通用事务引擎、旧预览自动重试、联网补全或启动。精确边界与职责示例见 [ADR 0004](adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md)、[实验指南](002-WORKSPACE-EXPERIMENT.md)和[开发指南](004-DEVELOPMENT.md)。

## Location 行为与持久化归属

Workspace 只持有公共可序列化 `LocationContract` 值 `{ type, schemaVersion, data }`。`ExtensionRegistry` 注册带独立 Schema 版本/范围和可移植 JSON Schema 的稳定类型定义，配置实例不是注册项。`AdapterRegistry` 注册描述与类型化运行实现，校验归属、Contract、Operation、Capability 和传入的每个 Location 类型/Schema 范围；比较必须支持两侧。`LocationBehaviorService` 每次操作先绑定，再访问运行实现；比较可以未知/不可比较，解析可返回非路径类型化资源。检查保留原始值，输出 validation、availability 与 Binding Plan。未知类型或不支持的 Schema 仍可读取和保留，报告 `unverified`/`unavailable`，不作为有效资源执行。

`packages/workspace-configuration` 拥有 TOML、元数据布局与读取/重命名/录入/恢复算法。其 `core.workspace-configuration` Adapter 使用 `owner: { kind: "module", id: "konogame.workspace" }`，随 core 统一版本，读取配置不依赖 filesystem Location 注册。Extension Adapter 使用 `owner: { kind: "extension", id: ... }`。filesystem 拥有 `fs.absolute`/`fs.relative` 定义和行为及原生发现 I/O。Host roots 是 Adapter 上下文，core 不解释路径语义。位置 Schema `1.0.0`、Contract `0.2.0` 与独立 Extension 版本各自区分。显式 Extension 依赖校验版本/循环，允许复用 filesystem 服务；内置/注入 source 支持惰性激活；显式根 Node 安装发现已可用，marketplace/下载及独立 host 隔离尚未实现。

候选与已有安装通过 Location Port 比较，不使用路径字符串或 JSON 序列化。新录入要求位置有效且可比较。Pending import 恢复通过 journal 完成已批准元数据，不访问位置资源，也不依赖其注册。已有 Node 读取/重命名 transport 保留于 core，录入 I/O 可注入，不宣称全部 transport 已抽象。参见 [ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)与实用 [Location 指南](005-LOCATION-AND-REGISTRIES.md)。

## 服务与 Extension 生命周期

`@konogame/infrastructure` 拥有运行注册表、激活、生命周期、绑定和 Temporal/ID 服务，不依赖业务 Module 或 Extension。领域/应用/实现包拥有各自 Port、token 和 provide 函数，apps 组装 source 与参数。单个内部 multi 发现来源流在加载运行代码前登记 manifest 及 Adapter/Location 贡献声明，内部提交先同步两注册表索引/snapshot，再以共享 catalogVersion 公开状态/结果，公开流不驱动同步。

`BindingService` 协商兼容性，在访问运行实例前惰性激活选中贡献/依赖。显式事件受尊重，推导需求选择兼容贡献。每代使用原生 Layer/Scope，root 替身优先，依赖 Context 仅限已声明 active 依赖。prepare/prepared 仅登记目录，initialize/ready 额外处理 startup。私有 PubSub 暴露只读状态/结果 Stream 和 snapshot，原生 Deferred/Fiber 协调完成。`ExtensionModule.layer` 提供服务，Effect `activate` 暂存实现直到成功。[ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 定义 Effect 4.0.6 契约。

依赖缺失/版本/循环错误保持可见且受阻，不禁用无关贡献；激活按代共享，成功后才发布运行实例。运行期新增无需 root 预装 Extension 服务，active 变更返回 `restart-service-required`，inactive 变更仅在没有 active 依赖者时允许。应用 Layer 获取完成初始化后暴露服务，Daemon 随后监听，Scope 拥有运行时释放。API 与加载范围见 [ADR 0006](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)和[服务/生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)。

## 入口与构建

Node 26 ESM 入口导出函数，仅在 `import.meta.main` 时执行，导入不启动进程。按需使用 `import.meta.dirname`/`import.meta.filename`，不重建对应路径。`apps/cli` 与 `apps/daemon` 各自合并所有者 Layer，并选择内置 filesystem/Steam 和显式配置的已安装来源。用例留在拥有该能力的模块。`packages/game` 可以依赖 `packages/workspace`，`workspace` 不反向依赖 `game`。多个跨 Feature 组合确实无法由现有模块承接时，才增加 `packages/layer-composition`。已退役的组装包见 [ADR 0009](adr/0009-APPLICATION-COMPOSITION.md)，现行 Effect 规则见 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。各包通过 tsdown 非打包构建独立 JavaScript/声明文件，导出指向 `dist` 产物。dev-cli 是 `scripts/dev-cli/src/main.ts` 所在 workspace。测试使用 Vitest。日常命令从 `just` 进入，并转发给负责该范围的工具：`just check` 转发到 `pnpm check`，执行 Biome、构建、类型检查、测试、文档检查和发布 metadata 校验。pnpm、Node，以及以后的 Cargo、uv，继续提供各自范围内的命令，agent 也可以直接调用。

CLI 使用 Optique 命令解析器与 clack TTY 辅助。无命令菜单和缺参提示遵循参数 > 环境 > TTY。`--non-interactive`、`--interactive=false`、`INTERACTIVE=false` 禁用提示；JSON/非 TTY 执行不提示，取消不写入。

TypeScript 项目共享 `tsconfig.base.json`，各 workspace 通过独立配置与 references 声明依赖。根 solution 引用这些项目，以及独立的测试和构建工具项目。`customConditions: ["monorepo-tsc"]` 选择 workspace exports 中位于 `types`/`import` 之前的源码入口，使编辑器无需等待包构建即可解析源码。执行导入继续使用 `dist`。测试项目另外启用 `test` 条件，从而解析生产项目无法解析的仅源码子路径。`just typecheck` 转发到 `pnpm typecheck`，后者使用 `tsc --build`；声明映射和增量产物写入已忽略的 `dist-tsc/`，与 tsdown 产物分别存放。 根目录和各 workspace 的 `tsconfig.json` 仅引用适用的 `tsconfig.app.json`、`tsconfig.lib.json`、`tsconfig.tool.json` 与 `tsconfig.test.json` 项目。每个包拥有独立测试项目，显式引用生产依赖，生产构建排除测试。Vitest 分组运行 `src/**/__tests__/` 中单个规则或服务的单元测试、workspace 或仓库 `tests/integration/` 中的完整用户流程集成测试，以及 workspace 或仓库 `tests/e2e/` 中的程序用户流程测试；可用 `just test --project unit`、`integration` 或 `e2e` 单独运行一组。一次性测试文件放在仓库根目录或所属 workspace 的 `temp/tests/`：层次名称保持稳定，只有最后一级是随机 UUIDv7。见[开发指南](004-DEVELOPMENT.md)。

## 集成职责

- **Ludusavi**：未来用于存档发现、导出、导入的 Adapter，而不是存储层。
- **Kopia**：未来可供 Save、Patch 等 Module 共享的 snapshot/blob 基础设施 Adapter；版本化仍是可选能力。
- **OpenDAL**：未来的存储/复制 Adapter 与后端配置映射；core 不解释厂商特有配置。
- **Trilium**：未来用于攻略、笔记、成就日志的 Module 集成。
- **Syncthing / Rclone / RustFS**：处于复制与存储下层。Syncthing 可同步文件系统副本，Rclone 可连接远端，RustFS 可提供 S3 端点；它们不是 Save Module API。

早期设计作为[历史草案存档](archive/README.md)保留。Windows 挂载、UI、启动编排、外部进程协议和持久化策略需要另行决策。

## 安装来源与运行稳健性

Core 在关系检查/loader 前严格校验声明，安全隔离错误 source 条目，拒绝时保留已接受目录。稳定 source ID 与可取消 DiscoveryBatch 驱动刷新差异，不完整扫描不删除未发现旧项。`packages/extension-discovery-node` 拥有显式配置的一层安装扫描及纯数据包元数据，core 不依赖它。CLI extension list/status/refresh 只准备目录，短命 refresh 不是持久安装管理。阶段截止时间和结构化诊断限制异步等待并报告清理不完整，不提供隔离或强杀。迟到目录变化重算已记忆事件和默认最近 256 个不同完整请求，不使用请求键定义资源身份。参见 [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)和 [VS Code/Theia 对照](007-EXTENSION-SYSTEM-COMPARISON.md)。

## Workspace 管理与游戏库查询

[ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md)在已有配置 Port 增加严格初始化/编辑/恢复 Operation。领域计划计算单记录变更，应用只读预览携带原始修订、身份、意图/差异、read/apply 绑定与摘要；apply 独立检查 root 并重建审核。核心配置拥有独占初始化和带 journal 的 AST 编辑，共享写入协调，不承诺多文件原子性或外部编辑器 compare-and-swap。元数据编辑/恢复保留 Location，不执行资源。游戏库 list/show 关联身份与可用性，explain 展示七层、来源/清除与 Feature 兼容性，不执行资产操作。准确 CLI、替换语义与限制见[管理指南](008-WORKSPACE-MANAGEMENT.md)，Schema 4 及发行版本不变。

## 测试边界与任务图

测试按验证边界分类：隔离规则/服务属于单元测试；服务组合、注入 CLI 派发/提示以及进程/模块契约属于集成测试；启动已构建程序入口，以正常组装和真实一次性 Workspace 执行用户流程属于端到端测试。使用子进程本身不能定义端到端测试。`just test --project unit`、`integration` 或 `e2e` 选择 Vitest 项目。Turborepo 通过 pnpm 为测试调度所需 `dist` 构建，构建产物使用本地缓存，测试始终执行。直接运行 `just cli`、`just daemon`、`just dev-cli` 仍需显式构建。见 [ADR 0010](adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)和[开发指南](004-DEVELOPMENT.md)。

## Effect 契约与作用域执行

有副作用 Port 返回带 owner 具名错误的 `Effect<Success, Error, Requirements>`，纯规则与 Schema 保持纯。Composition 返回原生 Layer，Scope 拥有流、句柄、listener 和激活代。原生 Fiber/Deferred/Clock 替代自制调度与取消；Promise/run 桥接仅在真实进程/框架/测试边界。清理预算是协作式的，不是强制终止；中断无法携带附加 finalizer 失败时，恢复 journal 与结构化 stderr 日志保留可处理证据。Contract 协议 `0.2.0` 要求 `>=0.2.0 <0.3.0`，Schema 4 和发布版本不变。参见 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 与[生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)。

[English](../en/001-ARCHITECTURE.md) | [中文](001-ARCHITECTURE.md)
