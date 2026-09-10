# Konogame (このゲーム)

Konogame 是面向游戏资产的可扩展框架，目标是管理存档、补丁、MOD、攻略、工具及各种不规则格式。本仓库目前包含 TypeScript 架构骨架、filesystem 存档存储原型、TOML Workspace 初始化、单记录审核编辑与检查/重命名实验及本地 Steam/散装发现与审核录入，尚不能作为完整游戏管理器使用。初始设计与代码经过 AI 辅助。

## 当前设计

[项目 metadata](../../konogame-metadata.toml) 是当前版本与兼容声明的真源。Core 可执行程序/包统一发行版本，每个 Extension 独立版本。详见[更新日志](CHANGELOG.md)和[发布维护指南](003-RELEASE-MAINTENANCE.md)。

**Module** 组织用户可见的 **Feature**。Feature 通过可替换的 **Port/Contract** 调用 **Operation**。一个 **Extension** 可以提供多个 **Adapter**；Adapter 声明可执行的 Operation 和细粒度 **Capability**。应用服务先协商需求并解析 Adapter，输出 **Binding Plan**，再执行操作。

CLI 与 Daemon 是独立入口，各自组装所用模块的 Layer，不直接依赖 Kopia、Ludusavi 等具体工具。包括 Contract 包在内的 Core 包统一发行版本；协议另有版本，Extension 独立发布。默认 filesystem Adapter 逐文件流式保存多文件 Artifact，不强制提供历史版本。

## 运行原型

需要 Node 26 和 pnpm 12。mise 固定仓库工具，包括 just。在 Windows 上，Just 通过 PowerShell 7 执行 recipe，使参数保持为原生 argv。

`just` 是日常命令入口。每条 recipe 转发给负责该范围的工具：pnpm 执行 workspace 脚本，Node 执行已构建的 CLI、daemon 和 dev-cli。pnpm、Node，以及以后的 Cargo、uv，继续提供各自范围内的具体命令，agent 也可以直接调用。`just --list` 列出全部 recipe。

```sh
just setup
just check
just build
just cli features
just cli plan save.store
just cli save store path/to/a/save-directory
just cli workspace schema
just cli workspace inspect path/to/a/workspace
just cli workspace rename path/to/a/workspace <record-id> <uniform-name>
just cli game discover /synthetic/workspace --host-id <host-id> --source-id loose --scope /synthetic/games --json > /synthetic/preview.json
just cli game import /synthetic/workspace /synthetic/preview.json --candidate <candidate-key> --yes --json
just cli workspace recover-import /synthetic/workspace <operation-id> --yes --json
just daemon
```

`just setup` 安装固定工具和 workspace 依赖。CLI 默认把存档写入 `~/.konogame/saves`，可通过 `KONOGAME_SAVE_ROOT` 指定位置。Daemon 原型仅监听 `127.0.0.1:38417`，提供 `GET /health` 和 `GET /plan?feature=save.store`，尚不执行存档任务。

运行包入口前先构建。各包从 `dist` 导出 tsdown 生成的 ESM JavaScript 和声明文件，测试使用 Vitest。`just check` 转发到 `pnpm check`，执行 Biome、构建、类型检查、测试、文档校验和发布 metadata 校验。`just typecheck` 与 `just test` 转发到对应的 pnpm 脚本。`just dev-cli` 运行仓库工具，包括发布维护。Optique CLI 在 TTY 中提供 clack 提示，无命令时显示菜单，缺失参数可补问。`--non-interactive`、`--interactive=false` 或 `INTERACTIVE=false` 禁用提示（参数 > 环境 > TTY）。JSON/非 TTY 执行不提示，取消不写入。

人工 Workspace 配置采用 TOML 1.0（`workspace.experimental.4`）；机器 JSON 输出、JSON Schema 与 Artifact manifest 保持 JSON。UUIDv7 标识记录，`uniformName` 提供可读 Unicode 文件名后缀。双布局、显式清除、Host roots、重命名恢复和限制见下方实验文档与 ADR 0002。

TypeScript 共享选项位于 `tsconfig.base.json`，各 workspace 有独立的 `tsconfig.json`，根配置通过 project references 组织依赖。`monorepo-tsc` 导出条件让编辑器跳转和类型检查直接解析 workspace 源码；执行导入使用 `dist`。测试项目另外启用 `test` 条件，用于生产解析不可用的仅源码替身导出。`just typecheck` 转发到 `pnpm typecheck`，通过 `tsc --build` 检查项目图，声明文件和增量缓存写入已忽略的 `dist-tsc/`。测试与构建工具分别拥有独立的 TypeScript 项目。 根目录和各 workspace 的 `tsconfig.json` 仅引用适用的 `tsconfig.app.json`、`tsconfig.lib.json`、`tsconfig.tool.json` 与 `tsconfig.test.json` 项目。每个包拥有独立测试项目，显式引用生产依赖，生产构建排除测试。Vitest 分组运行 `src/**/__tests__/` 中单个规则或服务的单元测试、workspace 或仓库 `tests/integration/` 中的完整用户流程集成测试，以及 workspace 或仓库 `tests/e2e/` 中的程序用户流程测试；可用 `just test --project unit`、`integration` 或 `e2e` 单独运行一组。

`just lint` 使用 [Biome](https://biomejs.dev/reference/configuration/) 检查格式、推荐规则与导入顺序；`just format` 应用格式化及安全修复。本项目采用两空格、LF、双引号和行内类型修饰符（`import { A, type B }`），禁止 `enum` 与 `const enum`，允许经过前置校验的非空断言。生成的发布源码排除检查，包清单保留发布同步工具的格式。Git 忽略的构建产物及私人 `projections/` 排除处理。

发现需要已配置的 Host/source 与显式扫描范围。预览 JSON 保存在扫描目录之外；确认重查当前配置、证据与绑定。Steam 库引用不扩大范围。散装目录只是候选，不是已认证游戏；新增安装的 `launchEntries` 为空。本轮不联网补全、不启动、不修改游戏文件。Game/Installation 联合写入采用定向 journal/前向恢复，不是原子多文件事务。参数与恢复限制见[实验指南](002-WORKSPACE-EXPERIMENT.md)，领域职责与 Effect 4.0.6 Layer 组装见[开发指南](004-DEVELOPMENT.md)。

每条用例是所属模块的 `Context.Service` 和 Layer。CLI 与 Daemon 合并自己需要的 Layer：infrastructure（注册表、绑定计划和扩展目录）、Workspace 管理、游戏准入和存档写入。只准备目录的获取完成声明准备；默认获取在暴露服务前完成 startup。多个跨 Feature 组合确实无法由现有模块承接时，才增加 `packages/layer-composition`。参见 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。

## 目录

- `packages/infrastructure`：运行注册表、惰性激活、生命周期、绑定、Temporal/ID、绑定计划和扩展目录。
- `packages/extension-discovery-node`：显式安装根 JSON 扫描与复查后的惰性 factory 加载，随 core 统一版本。
- `packages/contracts`：版本化概念与流式 Artifact 契约。
- `packages/workspace`：Workspace Module、配置/历史契约、记录 Schema、覆盖规则，以及检查和编辑用例。
- `packages/workspace-configuration`：核心 TOML 持久化、元数据布局、读取/重命名/录入/初始化/编辑与定向恢复；提供 Module 所属的 `core.workspace-configuration`。
- `packages/game`：本地发现契约、候选/证据值、来源能力和准入用例，可以依赖 `workspace`。
- `packages/save`：Save Module 的 Feature/Port 定义和存档写入用例。
- `extensions/filesystem`：filesystem save-store、散装发现、原生发现 I/O，以及 `fs.absolute`/`fs.relative` Location 定义与行为。
- `extensions/steam`：有界本地清单发现，独立 Extension 版本与 `steam = "generic"` 软件兼容声明，经合成夹具验证。
- `apps/cli`、`apps/daemon`：独立进程入口。各自合并所有者 Layer，并选择内置 filesystem/Steam 与显式配置的已安装来源。
- `scripts/dev-cli`：仓库工具 workspace，入口为 `src/main.ts`，包含文档检查。
- `justfile`：日常命令 recipe，转发到 pnpm workspace 脚本和已构建的 Node 入口。
- `temp/`：已被 Git 忽略的一次性文件。测试使用仓库根目录或所属 workspace 下的 `temp/tests/`，只有最后一级是随机 UUIDv7。见[开发指南](004-DEVELOPMENT.md)。

## 文档

- [当前架构](001-ARCHITECTURE.md)
- [ADR 0010：测试边界与任务图](adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)
- [ADR 0011：Effect 契约与生命周期](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)
- [ADR 0009：应用组装](adr/0009-APPLICATION-COMPOSITION.md)
- [更新日志](CHANGELOG.md)
- [Workspace 管理](008-WORKSPACE-MANAGEMENT.md)
- [ADR 0008：Workspace 管理](adr/0008-WORKSPACE-MANAGEMENT.md)
- [Extension 系统对照](007-EXTENSION-SYSTEM-COMPARISON.md)
- [ADR 0007：发现与运行稳健性](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)
- [服务与 Extension 生命周期](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)
- [ADR 0006：服务归属与惰性激活](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)
- [Location 与注册表](005-LOCATION-AND-REGISTRIES.md)
- [ADR 0005：Location 注册与核心持久化](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)
- [开发指南](004-DEVELOPMENT.md)
- [ADR 0004：本地发现与显式注入](adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md)
- [发布维护](003-RELEASE-MAINTENANCE.md)
- [本地 Workspace 实验](002-WORKSPACE-EXPERIMENT.md)
- [ADR 0001：能力绑定](adr/0001-CAPABILITY-BINDING.md)
- [ADR 0002：Workspace TOML 与工具](adr/0002-WORKSPACE-TOML-AND-TOOLING.md)
- [ADR 0003：发行版本与兼容性](adr/0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)
- [初始迭代计划](roadmap/001-INITIAL-ITERATIONS.md)
- [Workspace 配置与版本管理提案](roadmap/002-WORKSPACE-CONFIGURATION.md)
- [游戏发现提案](roadmap/003-GAME-DISCOVERY.md)
- [前端体验提案](roadmap/004-FRONTEND-EXPERIENCE.md)
- [历史设计存档](archive/README.md)
- [协作与文档规则](../../AGENTS.md)

当前契约放在 `docs/{lang}/`，已采纳决策放在 `docs/{lang}/adr/`，后续计划放在 `docs/{lang}/roadmap/`。被取代的设计放在 `docs/{lang}/archive/`；其中 Rust 服务端和固定插件层级等设想已被取代。英文约定文档以根目录为真源，通过相对符号链接投影到 `docs/en/`；译文放在对应语言目录。

项目采用 [MPL 2.0 许可证](../../LICENSE.md)。

Location 是可序列化 `{ type, schemaVersion, data }` 值；未知类型/Schema 保持可读并保留，报告未验证/不可用。核心配置持久化属于 Module，读取不依赖位置注册。资源行为、比较和类型化解析需要兼容注册 Adapter。参见 [ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)和 [Location 指南](005-LOCATION-AND-REGISTRIES.md)。

服务、Port 和 Context.Service tag 归所属包。Application composition 组装 Layer，Scope 拥有应用与代际资源，私有 PubSub 暴露只读 Stream。先登记 manifest，再惰性激活 Effect 代码。活动目录变更保留 blocked/需要重启语义，支持显式安装根发现；marketplace 与独立 host 重载尚未实现。参见[服务/生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)。Contract 协议为 `0.2.0`、范围 `>=0.2.0 <0.3.0`；Schema 4 与 core/Extension 发布版本 `0.1.0-alpha.0` 保持不变。

已安装 Extension 仅从显式 `extensionRoots` 或绝对路径 JSON 数组 `KONOGAME_EXTENSION_ROOTS` 发现。`just cli extension list`、`status` 和 `refresh` 检查目录而不触发 startup/代码激活，每次 CLI refresh 仅影响当次短命运行时。已实现严格声明、一致目录版本与可取消阶段截止时间；超时不隔离或杀死代码。参见 [VS Code/Theia 源码对照](007-EXTENSION-SYSTEM-COMPARISON.md)和 [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)。

Workspace 管理现支持从已有目录以禁用历史初始化、新增 Host、审核有限元数据/settings/roots/sources 编辑，以及游戏库查询/设置解释。编辑保留身份和未知 Location，apply 重建新鲜审核，恢复仅前向完成定向元数据，不表示任意配置编辑器、启动或资产备份/恢复。参见[管理指南](008-WORKSPACE-MANAGEMENT.md)和 [ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md)。

## 测试与任务图

测试按验证边界分类：隔离规则/服务属于单元测试；服务组合、注入 CLI 派发/提示以及进程/模块契约属于集成测试；启动已构建程序入口，以正常组装和真实一次性 Workspace 执行用户流程属于端到端测试。使用子进程本身不能定义端到端测试。`just test --project unit`、`integration` 或 `e2e` 选择 Vitest 项目。Turborepo 通过 pnpm 为测试调度所需 `dist` 构建，构建产物使用本地缓存，测试始终执行。直接运行 `just cli`、`just daemon`、`just dev-cli` 仍需显式构建。见 [ADR 0010](adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)和[开发指南](004-DEVELOPMENT.md)。

[English](../../README.md) | [中文](README.md)
