# Konogame (このゲーム)

Konogame 是面向游戏资产的可扩展框架，目标是管理存档、补丁、MOD、攻略、工具及各种不规则格式。本仓库目前包含 TypeScript 架构骨架、filesystem 存档存储原型和 TOML Workspace 检查/重命名实验，尚不能作为完整游戏管理器使用。初始设计与代码经过 AI 辅助。

## 当前设计

[项目 metadata](../../konogame-metadata.toml) 是当前版本与兼容声明的真源。Core 可执行程序/包统一发行版本，每个 Extension 独立版本。详见[更新日志](CHANGELOG.md)和[发布维护指南](003-RELEASE-MAINTENANCE.md)。

**Module** 组织用户可见的 **Feature**。Feature 通过可替换的 **Port/Contract** 调用 **Operation**。一个 **Extension** 可以提供多个 **Adapter**；Adapter 声明可执行的 Operation 和细粒度 **Capability**。应用服务先协商需求并解析 Adapter，输出 **Binding Plan**，再执行操作。

CLI 与 Daemon 是独立入口，复用同一应用服务，不直接依赖 Kopia、Ludusavi 等具体工具。包括 Contract 包在内的 Core 包统一发行版本；协议另有版本，Extension 独立发布。默认 filesystem Adapter 逐文件流式保存多文件 Artifact，不强制提供历史版本。

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
just daemon
```

`just setup` 安装固定工具和 workspace 依赖。CLI 默认把存档写入 `~/.konogame/saves`，可通过 `KONOGAME_SAVE_ROOT` 指定位置。Daemon 原型仅监听 `127.0.0.1:38417`，提供 `GET /health` 和 `GET /plan?feature=save.store`，尚不执行存档任务。

运行包入口前先构建。各包从 `dist` 导出 tsdown 生成的 ESM JavaScript 和声明文件，测试使用 Vitest。`just check` 转发到 `pnpm check`，执行 Biome、构建、类型检查、测试、文档校验和发布 metadata 校验。`just typecheck` 与 `just test` 转发到对应的 pnpm 脚本。`just dev-cli` 运行仓库工具，包括发布维护。oclif CLI 在 TTY 中提供 clack 提示，无命令时显示菜单，缺失参数可补问。`--non-interactive`、`--interactive=false` 或 `INTERACTIVE=false` 禁用提示（参数 > 环境 > TTY）。JSON/非 TTY 执行不提示，取消不写入。

人工 Workspace 配置采用 TOML 1.0（`workspace.experimental.3`）；机器 JSON 输出、JSON Schema 与 Artifact manifest 保持 JSON。UUIDv7 标识记录，`uniformName` 提供可读 Unicode 文件名后缀。双布局、显式清除、Host roots、重命名恢复和限制见下方实验文档与 ADR 0002。

TypeScript 共享选项位于 `tsconfig.base.json`，各 workspace 有独立的 `tsconfig.json`，根配置通过 project references 组织依赖。`monorepo-tsc` 导出条件让编辑器跳转和类型检查直接解析 workspace 源码；普通运行时导入使用 `dist`。`just typecheck` 转发到 `pnpm typecheck`，通过 `tsc --build` 检查项目图，声明文件和增量缓存写入已忽略的 `dist-tsc/`。测试与构建工具分别拥有独立的 TypeScript 项目。 根目录和各 workspace 的 `tsconfig.json` 仅引用适用的 `tsconfig.app.json`、`tsconfig.lib.json`、`tsconfig.tool.json` 与 `tsconfig.test.json` 项目。每个包拥有独立测试项目，显式引用生产依赖，生产构建排除测试。Vitest 分组运行源码同级 `__tests__/*.test.ts` 单元测试、包内 `tests/integration/*.test.ts` 集成测试，以及包内或仓库级 `tests/e2e/*.test.ts` 端到端测试；可用 `just test --project unit`、`integration` 或 `e2e` 单独运行一组。

`just lint` 使用 [Biome](https://biomejs.dev/reference/configuration/) 检查格式、推荐规则与导入顺序；`just format` 应用格式化及安全修复。本项目采用两空格、LF、双引号和行内类型修饰符（`import { A, type B }`），禁止 `enum` 与 `const enum`，允许经过前置校验的非空断言。生成的发布源码排除检查，包清单保留发布同步工具的格式。Git 忽略的构建产物及私人 `projections/` 排除处理。

## 目录

- `packages/contracts`：版本化概念与流式 Artifact 契约。
- `packages/workspace`：Workspace Module、配置/历史契约、记录 Schema 与覆盖规则。
- `packages/save`：Save Module 的首批六个 Feature/Port 定义。
- `packages/application`：能力协商、Adapter 解析和共享应用服务。
- `extensions/filesystem`：filesystem save-store 与 Workspace 配置 Adapter。
- `apps/cli`、`apps/daemon`：独立入口；`apps/shared` 是 `@konogame/local-runtime`，组装入口为 `src/index.ts`。
- `scripts/dev-cli`：仓库工具 workspace，入口为 `src/main.ts`，包含文档检查。
- `justfile`：日常命令 recipe，转发到 pnpm workspace 脚本和已构建的 Node 入口。

## 文档

- [当前架构](001-ARCHITECTURE.md)
- [更新日志](CHANGELOG.md)
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

[English](../../README.md) | [中文](README.md)
