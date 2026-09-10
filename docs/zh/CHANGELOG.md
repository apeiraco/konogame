# 更新日志

Core 可执行程序与包使用统一版本；各 Extension 独立版本，分别记录在下方专属小节。本次 alpha 记录当前本机原型，不表示已经发布到软件包仓库。

## Unreleased

### 变更

- 用 Optique 1.3 命令解析器替换 CLI、daemon 和 dev-cli 中的 oclif。公开参数保持不变，包括空格分隔的子命令、`--json`、`--non-interactive`、`--interactive=false`、`-h` 和 `-v`。补全覆盖 Bash、zsh、fish、PowerShell 和 Nushell。注入测试调用导出的运行函数；已构建入口作为进程运行。

- 退役 Application 聚合和 `packages/application-composition`。用例回到拥有该能力的模块：绑定计划和扩展目录在 infrastructure，Workspace 检查和编辑在 workspace，发现准入在 game，存档写入在 save。CLI 与 Daemon 各自合并这些 Layer。多个跨 Feature 组合确实无法由现有模块承接时，才增加 `packages/layer-composition`。`packages/core` 改名为 `packages/infrastructure`；共享发行组名 `core` 不变。

- 外部依赖版本改为在 pnpm 默认 catalog 中声明一次。各包清单使用 `catalog:`，并开启 `catalogMode: strict`。Workspace 发布版本仍由 `konogame-metadata.toml` 维护。

- 按所证明的流程划分测试。一条规则、一个服务、一个 Adapter 的真实目录夹具，以及 CLI 帮助/参数/JSON，归入单元测试。集成测试保留完整用户流程，以及这些流程中已经识别的失败。

### 新增

- 将有副作用 Port、Adapter、应用与入口迁移至精确 Effect 4.0.6：owner Context.Service/Layer、Scope/Fiber/Deferred/Clock、PubSub/Stream 观察和按需多文件 Artifact，替代此前 DI/Promise 组装与手写生命周期。组合入口返回完整原生 Layer，测试通过 owner Layer 与 TestClock 替换依赖；新增双语 ADR 0011。Contract 协议升为 `0.2.0`、范围 `>=0.2.0 <0.3.0`，Schema 4、extension.package.1 和 core/Extension 发布版本 `0.1.0-alpha.0` 不变。保留 journal/锁与批准元数据恢复，中断清理使用协作式预算和结构化 stderr 诊断。已知规则错误细分为 owner tag/结构化 issue，保留可信代码 defect 与中断 Cause，root 服务提前访问返回类型化组装失败。

- 早期切片将单次 CLI 调用上下文模块与 API 改名为 `context.ts`、`CliContext`、`cliContextStorage` 和 `getCliContext()`，保持命令行为；[ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 随后以 owner Context.Service 与作用域内的 `CLI_COMMAND_BRIDGE` 替代 storage/getter 机制，保留 `context.ts` 与 `CliContext` 命名。

- 按目的明确测试边界，区分注入/进程集成契约与已构建程序的 Workspace 用户流程，增加差异化 Vitest 时限、经 DI 注入的实验性虚拟文件系统测试、CLI 进程/终端覆盖和 Turborepo 构建依赖。新增双语 ADR 0010，不改变 Schema 与发行版本。

- 将依赖组装从 `apps/shared` 迁至 `packages/application-composition`（`@konogame/application-composition`）。根入口 `composeApplication` 不选择 Extension，`./local` 导出 `composeLocalApplication`，选择内置 filesystem/Steam 与显式启用的安装 roots。选项和上下文改用应用组装命名，不保留兼容别名；业务流程仍归 `packages/application`。新增双语 ADR 0009，Schema 与发行版本不变。
- 新增已有根 Workspace/初始 Host 初始化，历史禁用、独占预留配置并支持定向恢复；增加审核 Host/source/root 维护及单记录元数据/settings 编辑。
- 新增严格只读编辑预览与新鲜审核 apply、共享写入协调、保留注释/换行的 TOML 编辑及定向恢复。保留 UUID/uniformName/Location 与引用 source 不变量；记录字节 unchanged 不表示协调零写入。
- 新增游戏库 list/show、含来源/显式清除/Feature 可用性的七层设置解释，以及双语管理指南与 ADR 0008。不依赖 Git/Daemon，不提供任意编辑器或启动，不改变 Schema/版本。
- 新增严格声明/来源校验、带 catalogVersion 的 Extension/Adapter 内部一致提交、迟到事件/请求重算，并区分只准备目录与 startup。
- 新增随 core 统一版本的 Node 显式根安装包 JSON 发现、复查后的惰性入口/factory 加载、基于 revision 的刷新差异，以及只准备目录的 extension list/status/refresh CLI。不完整扫描保留旧项，已尝试 ESM 代码变更要求重启；CLI refresh 不是持久安装管理。
- 新增取消和可配置 discovery/load/activation/shutdown/cleanup 截止时间、结构化阶段诊断、迟到发布限制与明确清理不完整失败，不隔离或强杀同进程代码。增加双语 VS Code/Theia 对照和 ADR 0007，Schema 4 与发行版本不变。
- 新增核心服务归属、manifest 发现与惰性 Extension 激活，提供只读 RxJS 目录/运行状态、准备/启动屏障、原生 injection-js 子作用域及显式 active 依赖访问。激活成功后才发布 Adapter 运行实例，依赖问题保留目录诊断且不禁用无关能力。（此前切片记录；当前服务/异步/生命周期 API 由 ADR 0011 的 Effect 模型继任。）
- 增加内置/注入贡献来源及运行期注册/删除/替换 API，active 变更报告 `restart-service-required`；marketplace/下载、仅重载 Extension 和自动重启尚未实现。
- 用所属包 provider 替代应用本地 token/服务接线，新增异步 `composeApplication`/`composeLocalApplication`、异步计划与明确清理。CLI help/schema/version 不创建运行时，Daemon 初始化后监听。新增双语生命周期指南与 ADR 0006，Schema 4 及发行版本不变。
- 新增可序列化 Location 封装，Workspace 以 breaking change 升至 Schema 4；增加校验型 Extension/类型与 Adapter/运行注册表、逐操作位置绑定及非路径类型化资源。未知类型/Schema 可读取并保留为未验证/不可用；不提供 Schema 3 迁移或私人配置改写。
- 将 TOML、元数据布局及读取/重命名/录入/恢复移至核心 `@konogame/workspace-configuration`，通过 Module 所属 `core.workspace-configuration` 提供；filesystem 拥有位置类型/行为与原生发现 I/O。Adapter 描述/绑定显式声明 module/extension owner。Core 与 Extension 发行版本仍为 `0.1.0-alpha.0`，文件系统位置 Schema 独立为 `1.0.0`。
- 新录入要求有效且可比较的位置；已批准导入 journal 的恢复不执行位置、不依赖位置注册。增加双语 ADR 0005 与 Location/注册表实用指南。
- 新增 core `@konogame/game`、有界本地 Steam/散装候选预览，以及向已有 configured Host/source 的显式审核录入，严格重查修订/证据/绑定。
- 增加 injection-js 2.6.1 显式 token 组装、可替换 I/O/clock/ID/Adapter、合成流程测试，以及双语开发指南与 ADR 0004。（此前切片记录；当前服务/异步/生命周期 API 由 ADR 0011 的 Effect 模型继任。）
- 扩展本地发现与核心 Workspace 配置，新增 Game/Installation 追加录入、共享写锁、哈希/journal 校验及部分创建的显式前向恢复，保留已有记录字节/注释；跨文件创建不原子。

- 加入 Biome 推荐检查、行内类型导入/导出、enum 限制与统一格式化命令。
- 分离 Vitest 单元、集成与端到端测试，建立各包独立测试项目及显式 TypeScript 引用。

## 0.1.0-alpha.0 - 2026-10-17

### 新增

- TypeScript Module、Feature、Port/Contract、Operation、Capability、Extension、Adapter 和 Binding Plan，CLI 与 Daemon 复用应用服务。
- 流式多文件 Artifact 与默认 filesystem 存档存储，不强制启用历史或 Daemon。
- TOML 1.0 Workspace Schema 3，分离 Game、Host、Installation 身份，支持 UUIDv7、七层覆盖、显式清除、类型化路径和任意 Host roots。
- Unicode `uniformName` 文件名投影、等价文件/目录布局，以及保留注释、检查冲突并支持中断恢复的重命名。
- oclif 与 Clack 命令行、安全 ESM 入口、tsdown 构建、Vitest 验证及直接解析源码的分层 TypeScript 项目配置。
- 双语架构、ADR、路线图与历史文档存档。
- 项目 metadata 真源、统一 Core 版本、独立 Extension 版本、Contract 兼容范围、软件兼容声明及本地 release 维护命令。

### 兼容性

- Core 版本：`0.1.0-alpha.0`；Contract 协议版本：`0.1.0`；兼容 Contract 范围：`>=0.1.0 <0.2.0`。
- 实验阶段 Schema 和 API 允许 breaking change，不提供历史迁移或兼容读取层。
- `latest` 表示软件版本尚未固定或测试不足；`generic` 表示基于协议/格式、不绑定软件发行号的适配。路线图中描述的未来 Extension 尚未实现。

## konogame.filesystem@0.1.0-alpha.0 - 2026-10-17

### 新增

- `filesystem.save-store`：流式多文件存档存储。
- `filesystem.workspace-configuration`：严格 TOML 检查与实体重命名、恢复。

### 兼容性

- Contract 范围：`>=0.1.0 <0.2.0`；运行软件：Node.js `>=26`。
- 本 Extension 的版本独立于 Core 推进。

## konogame.steam@0.1.0-alpha.0

### 新增

- 新增 `steam.game-discovery`，支持所选本地 Steam 库、有界数据型 KeyValues 解析、清单/安装证据与诊断，不自动扫描引用但未选中的库。

### 兼容性

- Contract 范围：`>=0.1.0 <0.2.0`；软件：Steam `generic`（格式集成，经合成夹具验证，不承诺所有版本兼容）。
- 不实现联网补全、可执行入口发现、启动或游戏文件修改；此 Extension 独立于 core 版本。

[English](../../CHANGELOG.md) | [中文](CHANGELOG.md)
