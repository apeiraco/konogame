# 04 开发指南

状态：当前 Effect 开发约束，2026-10-26。参见[当前架构](001-ARCHITECTURE.md)和 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。

## 身份与职责

Game、Host、Installation 是 UUID 实体，名称和路径变化不改变身份。范围、证据和外部引用描述值。候选键标识观察，不是 Game。可靠 Steam App ID 可复用 Game；相似标题与目录名不能建立身份。新增对象明确区分实体与值对象：实体使用稳定 ID，值对象按值比较；Schema 与领域服务承载当前不变量，复杂行为采用类封装。

领域服务表达领域决策；拥有该能力的模块编排配置读取、绑定、发现、审核与写入；Extension 负责厂商解析和位置相关 I/O。核心 Workspace 持久化拥有 TOML 与元数据算法，保留已有 Node 读取/重命名 transport，录入 I/O 可注入。[Game 契约](../../packages/game/src/index.ts)定义范围/证据/候选；[准入](../../packages/game/src/admission.ts)校验录入并重建记录；[Steam](../../extensions/steam/src/index.ts)和 [filesystem 发现](../../extensions/filesystem/src/game-discovery.ts)实现 Port；[WorkspaceConfigurationImporter](../../packages/workspace-configuration/src/workspace-import.ts)负责 journal 与前向恢复。

## 类与函数

有状态服务、复杂 Adapter、共享依赖/状态的流程使用 class，辅助方法保持 private，仅暴露支持的操作。避免巨型 `createXxxx` 闭包和互相引用的函数对象。小型纯 Schema/路径/值构造函数与组装工厂仍适用。具有多个命名创建路径的类采用 protected 构造器与静态工厂，不重载构造器。

Filesystem Adapter 通过 Layer 取得 owner I/O 服务。类封装状态与算法，获取与资源归属由 Effect/Scope 管理。

## Effect 服务与测试

精确使用 `effect`、`@effect/platform-node`、`@effect/vitest` 4.0.6。这些版本以及其他外部依赖范围只在 `pnpm-workspace.yaml` 的默认 catalog 声明一次。各包清单用 `catalog:` 引用；`catalogMode: strict` 会拒绝 `pnpm add` 写入直接版本范围。workspace 包继续使用 `workspace:`。包的发布版本仍在 `konogame-metadata.toml`。Owner 的 `Context.Service` tag 声明依赖，原生 `Layer` 构建服务，`Scope` 拥有资源。只有下一步使用上一步结果时才连续 `yield*`。互不依赖的 Effect 用 `Effect.all` 并发收集；数组或集合用带明确并发度的 `Effect.forEach`；需要持有 fiber 时用 `Effect.forkChild` 分叉，再用 `Fiber.join` 或 `Fiber.joinAll` 汇合。有副作用的 Port、Adapter 与应用流程返回带 owner 具名错误的 `Effect<Success, Error, Requirements>`；Schema、值、解析器和规则保持纯函数。Promise 转换只位于真实 Node、Optique、Clack、动态 import 与测试边界；run API 只在进程、框架和测试边界执行。

服务、Port、tag 与 `provideXxx` Layer 归所属包。infrastructure 拥有注册表、激活、生命周期、绑定、Temporal/ID 服务、`LOCATION_BEHAVIOR`、绑定计划和扩展目录。Workspace、Game 和 Save 拥有各自的用例与 I/O 服务；并存实现使用不同 tag。Layer 接线不替代 Contract/Operation/Capability/Location 协商。

CLI 与 Daemon 各自合并所有者 Layer。只准备目录的命令完成声明准备，其他命令在暴露服务前完成初始化。入口通过纯 `/providers` 选择内置 filesystem/Steam 与显式启用的安装发现。业务包不导入入口。多个跨 Feature 组合确实无法由现有模块承接时，才增加 `packages/layer-composition`。

```ts
import { FEATURE_PLAN, provideFeaturePlan, provideIdService, provideInfrastructure } from "@konogame/infrastructure";
import { gameModuleSource } from "@konogame/game";
import { saveModuleSource } from "@konogame/save";
import { workspaceModuleSource } from "@konogame/workspace";
import { Effect, Layer } from "effect";

const infrastructure = provideInfrastructure({}, [
  saveModuleSource(),
  gameModuleSource(),
  workspaceModuleSource()
]).pipe(Layer.provideMerge(provideIdService({
  uuidV7: () => Effect.succeed("01900000-0000-7000-8000-000000000001")
})));

export const program = Effect.gen(function* () {
  return yield* (yield* FEATURE_PLAN).features();
}).pipe(Effect.provide(provideFeaturePlan().pipe(Layer.provideMerge(infrastructure))));

// Importing this module must not start the application.
if (import.meta.main) {
  await Effect.runPromise(program);
}
```

同一规则覆盖全部进程脚本，包括测试子进程。导出操作，或只在 `import.meta.main` 下执行。只有宿主无法加载模块时，才允许不加判断的顶层脚本。示例固定 ID 仅用于合成测试；生产使用 UUIDv7 服务。测试替换 owner Layer，以 `@effect/vitest` 和 `TestClock` 控制 Effect 与时间；纯测试继续使用普通 Vitest。真实文件系统、进程与 PTY 测试保留原生执行。替身应经过真实流程，覆盖修订/证据过期、独立 root 锚定、严格字段、目录一致性、惰性激活、失败发布和清理。参见[服务/生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)和 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。

Effect 行为测试通过 `@effect/vitest` 的 `it.effect` 返回 Effect，以 TestClock 控制时间并用真实 Fiber/Scope 验证取消。原生文件系统和 live-clock 集成测试使用 `it.live`，不要默认冻结它们的时钟。已知失败用 `Effect.flip`、Exit/Cause 和 owner tag/issue 断言，不为每个测试包 runPromise。纯 Schema/解析器/值/类型测试保留普通 Vitest，不为统一把纯工作包成 Effect。Promise 桥仅保留在真实外部 I/O、框架/进程和夹具边界，物理夹具清理由一个 Scope 或 hook 拥有。

## 类型化规则失败与缺陷

预期拒绝在规则或 Schema 检查处按 owner tag 与结构化字段分类；人类消息和 operation 标签不决定错误类别。

| 所属包 | 已知失败协议 |
| --- | --- |
| Contracts | `SchemaValidationError` 携带 schemaId 与 path/message/rule issues，union/intersection 分支另有可选 children。父级 path 可能为空，应检查子级路径，不解析消息反推位置。纯 `assertSchema` 使用 Schema 结果 API，不把任意求值异常转为校验失败。 |
| Workspace | `WorkspaceInvalidInputError`、`WorkspaceNotFoundError`、`WorkspaceConflictError` 携带规则 issue 或资源标识；`WorkspaceRuleFailure` 包含这些与 Schema 失败。 |
| infrastructure | `FeatureNotFoundError`、`ExtensionNotFoundError` 和 `BindingUnavailableError` 覆盖缺失 Feature、缺失 Extension，以及绑定、运行时或操作缺口。 |
| Workspace 用例 | `WorkspaceSelectionError` 与 `WorkspaceReviewMismatchError`（`reviewKind: "workspace-edit"`）归 Workspace 管理。 |
| 游戏准入 | 输入、候选、冲突、审核（`reviewKind: "game-discovery"`）以及来源/位置比较失败归准入。 |
| Configuration | `WorkspaceConfigurationError` 是公开 union，包含 Schema/规则失败；WorkspaceFileSystemFailure、ConfigurationInvalidInputFailure、WorkspaceWriterConflictFailure、WorkspaceWriterRecoveryFailure 数据协议；UnexpectedBoundaryError；以及新录入可能产生的 LocationError。原生文件系统与配置输入错误类仍归配置实现包。 |

`infrastructureRule`、`workspaceRule`、`admissionRule` 和 `configurationRule` 桥接同步规则时，把已识别错误对象原样保留为 Fail；可信纯代码的未知 throw 保持 Die。Operation annotation 只提供诊断上下文。Port Effect 保留自然错误 union，包括文件系统 tag/code/cause；Schema 或规则拒绝不能伪装为 I/O。在明确标识的外部解析器/求值器边界，已知语法拒绝使用结构化输入类别，第三方未知 throw 才可成为带 boundary 与原 cause 的 `UnexpectedBoundaryError`。该类不是业务流程、Port 或全部 Schema hook 的通用兜底；穷尽处理仅覆盖声明的已知 union，不涵盖任意第三方行为或 defect。

配置结果处理只恢复全部由 Fail reason 构成的 Cause；任何 Die 或 Interrupt 通过 failCause 继续传播。既有 conflict/recovery status 保持普通结果，保留 recovery-required 清理诊断。测试断言 tag 与 issue 字段，对已知 union 验证 catchTag/穷尽处理，并分别验证 defect/中断。参见[共享校验](../../packages/contracts/src/validation.ts)、[Workspace 协议](../../packages/workspace/src/errors.ts)、[绑定规则](../../packages/infrastructure/src/binding-errors.ts)、[准入规则](../../packages/game/src/admission-errors.ts)与[配置规则](../../packages/workspace-configuration/src/workflow-errors.ts)。

## 测试边界与任务图

先按所证明的流程分类，再选择目录和执行工具。单元测试负责一条规则或一个服务，包括正常路径和失败；在内存中组合其已声明依赖，或用真实目录验证一个 Adapter，仍是单元测试。集成测试是完整用户流程，或该流程中已经识别的失败，例如发现准入、Workspace 重命名/导入/编辑恢复、写入协调，以及写入前取消。集成测试不启动进程。端到端测试只保留测试进程观察不到的一种行为，并让这一组观察只启动一次进程：导入副作用、已构建 argv、真实终端、进程崩溃，或会污染后续导入的解析钩子。已构建 argv 冒烟和真实终端不接收注入的服务，也不伪造 `isTTY`。子进程不能决定类别。

| Vitest 项目 | 位置 | 测试 / hook 时限 | 文件调度 |
| --- | --- | --- | --- |
| `unit` | workspace `src/**/__tests__/**/*.test.ts` | 10 秒 / 10 秒 | 隔离 fork，并行文件 |
| `integration` | workspace 或仓库 `tests/integration/**/*.test.ts` | 30 秒 / 30 秒 | 隔离 fork，并行文件 |
| `e2e` | workspace 或仓库 `tests/e2e/**/*.test.ts` | 60 秒 / 30 秒 | 隔离 fork，并行文件 |

三个项目使用同一套 worker 策略，文件一起并行。Vitest 5 只在 worker 上限不同时才要求分组。`just test --shard=1/N` 把同一套文件切给 CI；每一片仍等待同一次可缓存的 `^build`。

运行 `just test --project unit`、`just test --project integration` 或 `just test --project e2e`，可组合 Vitest 支持的筛选参数；`just test` 执行全部项目。这些命令进入 pnpm 的 Turborepo 图：workspace `build` 依赖 `^build`，输出 `dist/**`，根 `test:run` 依赖相关包构建。测试任务关闭缓存，命中构建缓存不能替代测试执行。共享构建配置与相关环境输入进入本地构建缓存计算。测试筛选参数仅传给 Vitest。切换实际 Node/工具环境后，若本地缓存可能来自旧环境，使用 `pnpm exec turbo run build --cache=local:rw --force` 强制重建。`just check` 保留 Biome、构建任务图、根 `tsc --build`、测试、文档与发布检查。TypeScript 继续由根目录单次 references 构建管理，避免争写 `dist-tsc/`。直接运行 CLI/daemon/dev-cli 仍需先 `just build`，然后执行已构建 Node 模块。

CLI 语法、帮助和补全使用 Optique 的解析器与运行辅助。注入的提示和服务在进程内调用导出的运行函数。命令矩阵留在这个运行函数上。一次新进程只覆盖测试进程观察不到的一种行为：导入副作用、已构建 argv、真实终端、进程崩溃，或会污染后续导入的解析钩子，并且这次进程属于端到端测试。已构建入口作为真实进程运行。进程不能决定类别。所有者端口的替换实现留在进程内，不挂载虚拟文件系统。Effect 延时使用 TestClock。

包只通过 `test` 条件导出测试替身，其余目标为 null。`@konogame/infrastructure/tests/support` 按服务各导出一个 Layer：`deterministicIdLayer` 对应 `ID_SERVICE`，`fixedTemporalLayer` 对应 `TEMPORAL_SERVICE`。测试项目从 `tsconfig.test-base.json` 继承该条件，并放在 `monorepo-tsc` 之前。Vitest 会用服务器默认条件覆盖 `resolve.conditions`，因此其配置把 `test` 加回实际解析测试导入的服务器环境。导出指向源码，包入口不再导出它，因此 tsdown 不会发布它。

execa 负责子进程输出/状态和等待时限；管道 CLI 测试通过 `cli-testing-library` 观察已构建 CLI 输出。该库独立于 Testing Library 组织，不创建 PTY。真实键盘/提示/取消测试使用 `node-pty` 和已构建入口，不伪造 `isTTY`。终端用例保持少量并明确验证平台行为。`cli-testing-library` 上游 Windows CI 警告针对该库自身，不能据此推断 `node-pty` 的平台限制。决策与上游参考见 [ADR 0010](adr/0010-TEST-BOUNDARIES-AND-TASK-GRAPH.md)。

当前[终端流程](../../apps/cli/tests/e2e/terminal.test.ts)已在本机 Windows ConPTY 验证：Ctrl-C 返回 130 且所选目录完整内容不变，随后真实键入 root 并确认，初始化后的 Workspace 文件记录该名称。该结果证明此本机 Windows 流程；其他平台终端行为仍需分别执行验证。

进程内测试替换所有者 I/O 端口，或使用 `temp/tests/` 中的真实目录。不挂载虚拟文件系统，也不把 Effect 的 `FileSystem` 当作替换点。子进程以及权限、符号链接、rename 和锁等原生文件系统行为使用真实目录。以后的虚拟或远程存储由实现现有所有者端口的 Extension 提供；OpenDAL 不是核心依赖。

## 临时文件

`temp/` 已被 Git 忽略，可以整目录删除。它只存放一次性测试文件和本地临时数据，不存放源码、需要提交的夹具或用户游戏数据。测试文件和子进程工作目录放在仓库根目录的 `temp/tests/`，或放在拥有该测试的 workspace（`apps`、`packages`、`extensions`、`scripts`）下的 `temp/tests/`。许多 Linux 的系统临时目录是空间很小的 tmpfs，因此测试不使用它。

目录使用稳定的层次名称，例如 `extensions/filesystem/temp/tests/unit/game-discovery/directory/<id>`。只有最后一级可以是随机生成的小写 UUIDv7。[`createTestDirectory`](../../tests/support/temp.ts) 会根据测试文件位置创建这一级。中间层级保持稳定名称，不使用 `mkdtemp` 后缀或 UUID。

## Location 与注册表开发

Location 是值对象。在所属 Extension 增加稳定类型定义，声明 Standard Schema 或 JSON Schema 以及独立 Schema 范围，再注册兼容行为及类型化运行实例。注册时把 `dataSchema` 保存为 JSON Schema。不在 Workspace 增加文件系统分支，不比较序列化值。核心配置是 Module 所属 Adapter，测试无 Location 注册时仍可读取。覆盖缺失 Schema/行为、比较两侧、非路径资源和显式未知结果。新录入要求位置有效且可比较；journal 恢复只完成已批准元数据，不执行资源。归属与真实注册链接见 [Location 指南](005-LOCATION-AND-REGISTRIES.md)和 [ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)。

## 发现与稳健性测试

Contribution 未声明 revision 时，未变扫描必须保持 load 函数 identity 稳定。内置 source 在工厂阶段一次建立 batch、contribution 与 loader，discover 返回稳定声明。提供 revision 的来源必须在内容或加载语义变化时更新 revision；不要用每次新闭包强制 replace，也不要用固定 revision 掩盖真实变化。

关系检查/loader 前使用严格 manifest Schema。新增 source 提供稳定 id 与可取消 DiscoveryBatch，明确 complete/diagnostics/revision 语义。测试坏结果、部分扫描保留旧记录、未变修订、冲突及已尝试代码的重启要求。目录观察者在内部提交后看到一致 catalogVersion/描述/代，公开 results$ 只观察；覆盖重入、迟到 Feature/Location 重放及完整请求保留。截止测试替换 owner Layer 并使用 TestClock；LifetimePolicy 保留普通 budget/demandCacheLimit 设置。验证迟到发布被封闭、拒绝已观察、清理不完整可诊断；同进程截止不能杀死同步代码。参见[对照证据与安装包用法](007-EXTENSION-SYSTEM-COMPARISON.md)和 [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)。

## 初始化与审核维护

Workspace 初始化、Host/source/root 维护、严格单记录元数据/settings 编辑、游戏库查询及设置解释已通过 [ADR 0008](adr/0008-WORKSPACE-MANAGEMENT.md)实现。准确命令和新鲜审核/恢复限制见[管理指南](008-WORKSPACE-MANAGEMENT.md)。保留 UUID/uniformName/Location、source 引用和无关 TOML 字节；settings 替换完整单层，不是深层 patch。元数据编辑/恢复不要求执行位置，也不依赖 Git 或 Daemon。Unchanged 保留记录字节，协调仍可能触及恢复文件；任意编辑、历史及启动仍待实现。

[English](../en/004-DEVELOPMENT.md) | [中文](004-DEVELOPMENT.md)
