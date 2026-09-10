# 初始迭代计划

状态：迭代计划，更新于 2026-10-17。当前实现包括 TypeScript 契约/应用骨架、流式 filesystem save-store、CLI/Daemon 原型和[TOML Workspace 检查/重命名实验](../002-WORKSPACE-EXPERIMENT.md)。有界 Steam/散装发现、预览录入与显式导入恢复也已实现。ADR 0008 已实现初始化、有限审核 Workspace 编辑和游戏库维护；任意编辑、配置历史、图形 UI 和持久任务仍未实现。实验 Schema/API 允许 breaking change，不实现历史 migration 或向后兼容层。

## 提案索引

| 提案 | 首个成果 | 主要依赖 |
| --- | --- | --- |
| [Workspace 配置与版本管理](002-WORKSPACE-CONFIGURATION.md) | 文件记录、稳定的 Game/Installation 身份、有效配置检查与带修订校验的编辑。 | 记录 Schema、校验与明确的写入单位。基础编辑之后再增加可选历史。 |
| [游戏发现](003-GAME-DISCOVERY.md) | 有范围的发现、带来源的候选、审核和显式 Workspace 录入。 | Workspace 身份与更新规则，以及发现来源和证据契约。 |
| [前端体验](004-FRONTEND-EXPERIENCE.md) | 配置/发现管理视图、准确的操作与任务状态，随后提供游玩模式导航。 | 共享应用客户端边界、可用流程和任务生命周期语义。 |

这些提案从存档中继承有价值的意图，并按当前架构调整。[ADR 0002](../adr/0002-WORKSPACE-TOML-AND-TOOLING.md) 已采纳 TOML、身份、重命名与工具基础；其余提案不代表已支持命令。Workspace 工作期间可用早期 UI 夹具澄清契约，但真实 UI 写入仍依赖与 CLI 相同的应用服务。

## 建议实施顺序

### 1. 契约与本地 Workspace

围绕首批流程完善错误类型、取消、进度、流所有权、带参数的 Capability、当前契约检查和 Extension 清单校验。增加完整 Binding Plan 检查，保留显式偏好不兼容时的可见失败；实验期间不搭建向后兼容框架。

当前切片采用 TOML 1.0 Schema 4、小写 UUIDv7 身份、原文统一名、等价平铺/目录布局、便携/本机文件分离、七层覆盖及带来源校验。Workspace 检查与专用重命名复用 Save 的绑定解析器，配置 Adapter 属于 Workspace Module。ADR 0002 中显式清除、Unicode 文件名编码及保留注释的重命名继续有效；ADR 0005 调整 Location 行为和 Host 根上下文。应用写入锁、修订/哈希检查和定向恢复限定重命名范围，任意外部编辑器竞争仍有明确限制。有界本地发现/录入已由 [ADR 0004](../adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md) 采纳，公开夹具使用合成数据。

初始化、来源/Host 维护及有限审核编辑已由 ADR 0008 实现；下一步按具体意图扩展并明确修订/恢复限制。filesystem 使用不依赖 Git 或运行中的 Daemon。接受破坏性的 Schema 调整，不建立 migration 子系统；修改已有文件仍需明确且可审核。

完成条件：本地 CLI 能查看和重命名实体，随后扩展可审核更新、解释有效值，并拒绝过期编辑而不丢失用户改动；契约与流行为有针对性的回归测试。

### 2. 发现录入与首个存档流程

Game 发现现已与 `save.discover` 区分：Steam 与散装 Adapter 实现有界观察、完成后的候选预览与显式录入；流式更新仍待实现。Effect 4.0.6 Layer 组装与可替换依赖见[开发指南](../004-DEVELOPMENT.md)。下一步扩展到 Epic、Xbox 受管位置及 Ubisoft/EA 场景；多个启动器描述同一安装时保留各自来源引用。用第二个来源的夹具验证确定性合并与部分失败，不隐式改变当前单请求解析规则。

针对一个支持的场景串联存档位置发现、导出、filesystem 存储与显式导入/恢复策略，处理多文件流并说明部分生效的影响。有明确格式对及语义后再增加转换。下一步评估基于 Ludusavi 的存档知识；联网元数据与 AI 在本地审核和录入流程可用后推进。

完成条件：显式选择的位置能产生可审核的候选，录入保留用户修正并避免重复；已知存档可导出、存储，并在明确的影响预览后主动导入。

### 3. 管理 UI，再到游玩交互

选择首个本地宿主和小型共享应用客户端接口。通过明确标注的夹具演示配置差异、发现审核、操作可用性和任务反馈，再接入已实现服务。引入后台运行前，先显示前台任务的生命周期限制。

启用真实游玩操作前定义启动语义。增加游玩模式的游戏库/详情流程、键盘/手柄导航、焦点恢复和减少动态效果支持。UI 使用应用提供的可用性与结果，不自行选择厂商工具。

完成条件：管理 UI 可完成已支持流程，不可用能力有解释，游玩导航不丢焦点；完成通知推荐显式操作，不自动启动游戏。

### 4. 可选历史与外部 Adapter

基础 Workspace 编辑完成后，在临时 Git 实验中实现推荐历史契约：受管便携路径、独立历史引用/索引、预期 head 检查、幂等操作 ID，以及通过应用校验进行恢复。实用前验证不干扰用户分支/索引。配置修订与资产快照分开；文件写入/历史记录部分失败时明确报告，不承诺跨系统事务。当前历史接口只是草案，尚无实现。

验证 Kopia 的快照/blob 基础设施与可选资产历史，以及 OpenDAL 的后端配置和存储/复制。在扩展 Blob、Snapshot、Replication Port 契约前先确定具体用途。各 Adapter 使用契约夹具和大文件流独立验证。基础 filesystem 工作在没有这些 Adapter 时仍需可用。

完成条件：每项可选集成都有明确的支持范围、能力可用性和独立契约测试；关闭历史不会关闭普通存储或配置编辑。

### 5. 其他资产与交付决策

定义 Feature 与 Artifact 后再引入 Patch、Notes Module。评估 Trilium 笔记集成；Syncthing、Rclone、RustFS 保持传输/后端角色。配置回退不意味着撤销已应用的补丁或其他资产操作。

通过独立 ADR 决定 Daemon 传输与鉴权、后台任务归属和恢复、Extension 加载/隔离、契约与扩展独立发布、兼容策略、桌面打包、远程客户端及其他平台。增加依赖、承诺持久任务或移动端能力一致之前，先选择具体用例。

完成条件：每次交付都有可运行的范围、适用时公开的兼容边界，以及明确的失败/恢复行为。前面阶段需要时，可以提前完成相关决策。

## 决策与文档规则

Node 26 ESM 入口导出函数并使用 `import.meta.main` 守卫。各包通过 tsdown 非打包构建独立 JavaScript/声明并导出 `dist`；CLI 与 Daemon 各自组装所有者 Layer，仓库工具为 `scripts/dev-cli` workspace。Optique/clack CLI 支持 TTY 菜单与补问，JSON/非 TTY 执行不提示。测试使用 Vitest。`just check` 转发到 `pnpm check`，执行构建、类型检查、测试和文档检查。

每个实施阶段应形成可运行的纵向切片，并围绕验收目标提供针对性测试。未来设计保留在 `roadmap/`，持久的已采纳决策进入 `adr/`，已实现实验行为记录到当前主题文档。历史记录继续作为背景保留，其中 Rust 服务端、固定插件层级和强制 Daemon 等假设不自动成为需求。私人观察留在实验仓库，只公开合成或经过有意脱敏的夹具。

## 位置边界更新

[ADR 0005](../adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)已完成 Schema 4 通用 Location 封装、校验型类型/运行注册表及核心 Workspace 持久化归属。未来受管集成需要自己的定义和兼容行为；marketplace/下载、独立 host 隔离仍待实现，显式安装根发现已实现。当前注册及版本示例见 [Location 指南](../005-LOCATION-AND-REGISTRIES.md)。

## 生命周期边界

Owner 服务归属、单来源贡献、惰性激活与安全运行期目录变更已由 [ADR 0006](../adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)实现。后续按具体需求增加独立 host、marketplace 集成；显式安装根发现现已补充内置/注入 source。

## 发现与稳健性后续

已安装发现、严格边界、一致目录提交、refresh 差异和有界生命周期等待已由 ADR 0007 采纳。跨会话选择有需求时再优先设计持久启停；watcher、分发和独立 host 需要明确策略/协议。证据及实施触发条件见 [ADR 0007](../adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)和[源码对照](../007-EXTENSION-SYSTEM-COMPARISON.md)。

## Workspace 管理增量

[ADR 0008](../adr/0008-WORKSPACE-MANAGEMENT.md)已实现已有根初始化、Host/source/root 维护、审核元数据/settings 替换及游戏库 list/show/explain。有限意图及定向恢复见[管理指南](../008-WORKSPACE-MANAGEMENT.md)。管理操作不授予发现范围，不修改游戏资源；下一步仍是资产备份/恢复、可选配置历史、更多启动器和 UI，任意编辑/删除与启动需独立契约。

## 测试与任务图基线

[ADR 0010](../adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md) 接受按目的划分测试边界、差异化 Vitest 项目与 Turborepo 构建依赖。当前验证区分注入式集成契约与已构建程序的 Workspace 用户流程。后续纵向切片应以合成夹具扩展相应边界；任务图准备产物，始终执行测试而不缓存测试成功。

[ADR 0011](../adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 的 Effect 契约、owner Layer、Scope 生命周期和 Stream Artifact 是当前基础。后续集成须实现协议 `0.2.0`（`>=0.2.0 <0.3.0`）与原生 Effect Port。Schema 4 和发布版本不变，未来独立托管仍需单独决策。

[English](../../en/roadmap/001-INITIAL-ITERATIONS.md) | [中文](001-INITIAL-ITERATIONS.md)
