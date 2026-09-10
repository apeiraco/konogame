# 06 服务与 Extension 生命周期

状态：当前 Effect 组装与生命周期，2026-10-26。[ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 继任 ADR 0004、0006、0007、0009 的 DI 与生命周期细节；[Location 指南](005-LOCATION-AND-REGISTRIES.md)定义资源语义。

## 服务归属与组装

| 所属包 | 职责 |
| --- | --- |
| `@konogame/infrastructure` | 注册表、激活、生命周期、绑定、Temporal/ID、生命周期策略和通用 `LOCATION_BEHAVIOR` 的 owner Context.Service tag 与 Layer；不导入业务 Module/Extension。 |
| 领域包 | Effect Port、owner 错误、Module 声明与 I/O 服务 tag；纯规则/Schema 保持纯。 |
| `@konogame/workspace-configuration` | TOML/布局算法、作用域化 Node I/O、writer 协调和定向恢复。 |
| `@konogame/workspace`、`@konogame/game`、`@konogame/save` | 各自能力的用例。游戏准入可以依赖 Workspace。 |
| Extension | 纯 manifest/provider、惰性 Effect loader、实现 Layer 与厂商/位置 I/O。 |
| Apps | 每个入口合并所有者 Layer，选择 filesystem/Steam 和显式安装根，并拥有进程/框架桥接。 |

`provideInfrastructure` 只组装注册表、激活、生命周期、绑定、Location、标识和时间。绑定计划和扩展目录是独立的 infrastructure Layer。CLI 与 Daemon 合并自己调用的用例 Layer。`extension` 命令只准备目录，其他 CLI 命令执行初始化。入口提供 filesystem saveRoot，Extension 不推断 home。导入入口模块不会启动进程。

Core root 组装保持单个原生 `Layer.effectContext`。访问器类型为 `Effect<Context<InfrastructureServices>, InfrastructureError>`，通过 Deferred.poll 读取：构造期间提前访问立即返回 Providers 阶段错误，不等待或暴露尚未赋值完整的上下文。完整服务图与生命周期 finalizer 安装后才完成 Deferred；后续读取共享固定 Context 与 root 替身。仅在已验证的动态 Extension 执行边界擦除 requirements。参见[core 组装](../../packages/infrastructure/src/providers.ts)与[root 访问测试](../../packages/infrastructure/src/__tests__/providers.test.ts)。

```ts
import { FEATURE_PLAN, provideFeaturePlan, provideIdService, provideInfrastructure } from "@konogame/infrastructure";
import { saveModuleSource } from "@konogame/save";
import { Effect, Layer } from "effect";

const infrastructure = provideInfrastructure({}, [saveModuleSource()]).pipe(
  Layer.provideMerge(provideIdService({
    uuidV7: () => Effect.succeed("01900000-0000-7000-8000-000000000001")
  }))
);

export const program = Effect.gen(function* () {
  return yield* (yield* FEATURE_PLAN).features();
}).pipe(Effect.provide(provideFeaturePlan().pipe(Layer.provideMerge(infrastructure))));

// Importing this module must not start the application.
if (import.meta.main) {
  await Effect.runPromise(program);
}
```

参见 [infrastructure Layer](../../packages/infrastructure/src/providers.ts)、[绑定计划](../../packages/infrastructure/src/binding-plan.ts)、[Workspace 管理](../../packages/workspace/src/management.ts)、[准入](../../packages/game/src/admission.ts)和[存档写入](../../packages/save/src/store.ts)。用例不导入入口。CLI 入口是 [apps/cli/src/main.ts](../../apps/cli/src/main.ts)，daemon 入口是 [apps/daemon/src/main.ts](../../apps/daemon/src/main.ts)。CLI 的 `context.ts` 拥有交互/输出。Optique 在所属 Effect 内解析参数；官方 Effect Runtime API 保留上游名称。Daemon 构建、监听和请求使用原生作用域。进程退出只发生在 `import.meta.main`。CLI JSON/非 TTY 不提示；取消不写入已批准业务变更，除非发布已越过不可取消边界。

已知 Schema/规则拒绝使用结构化 owner tag/issue；infrastructureRule、workspaceRule、admissionRule 和 configurationRule 把已识别对象保留为 Fail，可信代码未知 throw 保持 Die。UnexpectedBoundaryError 仅用于明确的第三方边界，不使任意 Extension/Schema 行为变得可穷尽。WorkspaceConfigurationError 包含已知 Schema/规则错误、文件系统/配置输入/writer 冲突与恢复数据协议、明确边界错误及新录入的 LocationError；实现类及原生 code/cause 保持原 owner。Cause-aware 结果处理不能把 Die/Interrupt 转为普通流程 status。参见[开发错误指南](004-DEVELOPMENT.md#类型化规则失败与缺陷)。

## Scope 拥有资源

句柄、流和外部资源使用 `Effect.acquireRelease`、`Effect.acquireUseRelease`、scoped Layer 和原生 finalizer。一个 Scope 拥有一个资源，按获取的逆序释放。业务代码不手动销毁服务或添加重复销毁容错标记；外部库已有释放语义保持不变。内存对象无需析构；不应持有对象的缓存使用 WeakMap/WeakRef。

Artifact 文件集合是 Stream，每个字节 Stream 按需打开，句柄归 Scope。消费者不缓冲完整资产或假设单文件。原生 Fiber/Deferred/Clock 表达并发、完成和时间，测试用 TestClock。业务 Port 不传播 AbortSignal；真实外部异步桥接可使用 Effect 提供的 signal。

## 先声明，按需激活

`ExtensionDiscoverySource` 有稳定 id，`discover(): Effect<DiscoveryBatch, unknown>`。Batch 包含 complete/contributions/diagnostics/restartRequired 语义。Contribution 包含 kind/manifest/惰性 `load()` 与可选 id/revision/reloadPolicy。Loader 返回 ExtensionModule 的 Effect，不提供 Promise 兼容 loader。纯 `/providers` 入口不静态导入运行实现。

关系与 loader 前先严格校验，包括错误/稀疏 source 项和未知字段。内部提交先更新两个注册表索引和 snapshot，再以同一 catalogVersion 发布通知。私有 PubSub 暴露只读 `state$`、`results$`、`diagnostics$` Stream 和 snapshot；公开结果不驱动同步。Stream 消费者作为归 Scope 的 fiber 运行。

`prepare()`/`prepared` 仅发现并登记目录，`initialize()`/`ready` 增加显式 startup。Binding 等待准备，协商 Contract/Operation/Capability/Location，惰性激活选中贡献和依赖后才访问运行实例。显式事件受尊重，推导需求只选择兼容贡献。内置 filesystem/Steam 无 onStartup。迟到声明重放已记忆事件与默认最近 256 个不同完整绑定请求；请求相等不定义资源身份。

`ExtensionModule.layer` 是可选 Layer 或接收激活上下文返回 Layer 的函数，`activate(context)` 返回 Effect。Core 每代构建一个原生 Layer/Scope，显式 root 替身优先且 root 固定。`context.dependencyServices(id)` 只返回已声明 active 依赖的 Context；Steam 以此取得 filesystem 服务。`context.registerAdapter` 暂存实现直到激活成功。同代并发激活共享原生完成状态，失败按代缓存；缺失/版本/循环依赖诊断可重新评估。不引入第二服务注册表。

Filesystem 惰性 loader 调用 `createFilesystemExtensionModule`，传入 composition 提供的 saveRoot。参见 [filesystem source](../../extensions/filesystem/src/providers.ts)、[filesystem module](../../extensions/filesystem/src/index.ts)、[Steam module](../../extensions/steam/src/index.ts)与[激活实现](../../packages/infrastructure/src/activation.ts)。

## 目录管理与安装代码

Contribution 未声明 revision 时，未变扫描必须保持 load 函数 identity 稳定。内置 source 在工厂阶段一次建立 batch、contribution 与 loader，discover 返回稳定声明。提供 revision 的来源必须在内容或加载语义变化时更新 revision；不要用每次新闭包强制 replace，也不要用固定 revision 掩盖真实变化。

`ExtensionLifecycle.register/refresh` 和注册表 replace/remove 保持 source-owned 增量。未变修订保留代；不完整/错误扫描不能删除未见旧项，冲突不能静默覆盖。缺失/不兼容/循环依赖保留合法声明和诊断，阻止其激活，不禁用无关能力。

只移除/替换无 active/activating 依赖者且不受 attempted-code 限制的 inactive 贡献。活动变更与已尝试 restart-after-load 代码（包括 loader 失败）返回 `restart-service-required`，不改变状态。没有 Extension 独立重载或自动重启。Node ESM 缓存要求真实进程/服务重启；新 Layer 或 URL cache-busting 无法释放代码。

`KONOGAME_EXTENSION_ROOTS` 是唯一绝对根的 JSON 数组。Node scanner 单层读取 data-only `extension.package.1`，检查 canonical/realpath 锚定、1 MiB manifest/256 candidate 限制，hash manifest 和流式 entry，并在惰性 import 前复查。修订检测变化，不认证代码或 hash 整个依赖树。没有默认 home/node_modules 扫描、marketplace、watcher 或独立 host 隔离。CLI extension list/status/refresh 只准备目录；短命 refresh 不持久化管理状态。参见[对照与安装指南](007-EXTENSION-SYSTEM-COMPARISON.md)。

## Filesystem 存档发布

内部[发布 helper](../../extensions/filesystem/src/publication.ts) 只重试 Windows 原生 rename 的 EPERM。它发布已写好的 staging 目录，不重放 Artifact 输入、不重新复制、不生成新 ID。最多五次总尝试，退避为可取消的 25/50/100/200ms，累计 375ms。基于 Effect Clock 的 500ms 软预算从 helper 入口计时，仅约束后续重试；首次尝试始终允许，包括初次 lstat 较慢时。在允许重试时检查预算，并在后续 rename 前、目标检查后再次检查。每个原生 rename 仅在单次调用中屏蔽中断并等待 settle；已开始的调用可能超过软预算。

每次尝试以 lstat 预检目标，任何既存目标立即失败；除 ENOENT 外的目标检查错误不重试。耗尽保留 SaveError/原生 cause，失败清理只移除自己拥有的 staging 目录，绝不删除目标。目标预检存在 TOCTOU 窗口，不是可移植的原子 no-replace 操作或通用事务。已观察到的原生 EPERM 根因仍未知，此有界策略不构成根因证明。


## 协作式截止与恢复

`coreOptions.budgets` 默认 discovery/load 各 15 秒、activation 30 秒、总 shutdown 5 秒、单 cleanup 1 秒；demandCacheLimit 默认 256。原生 Clock/Fiber/Scope 管理等待与清理。阶段诊断在可用时说明 source/贡献/代、cause 与耗时。单项失败后继续逆序清理，报告未完成清理，封闭迟到发布。

可协作的自定义 Extension cleanup 推荐通过 [addLifetimeFinalizer](../../packages/infrastructure/src/services.ts) 注册。它在代际 Scope 内使用原生 Effect.addFinalizer，以 interruptible cleanup 应用 LifetimePolicy 的单项与剩余总预算，不建立第二执行器。普通 Effect.acquireRelease/addFinalizer 的 release 和库资源 finalizer 保留原生 Scope 语义；其释放通常默认受不可中断保护，并不要求 Extension 显式屏蔽中断。1 秒/5 秒策略不是这些 finalizer 的通用硬截止，中断也不能证明句柄已关闭。

这些截止是协作式的。同步不让出的代码、刻意不可中断 Effect 和不可取消外部操作可能超过截止；同进程调度不能强制终止或 sandbox。没有游离清理 scheduler。最小原生文件系统发布步骤可能屏蔽中断直到单步完成。

Workspace 写入在作用域内取得/释放 writer，仅释放自己拥有的锁。取消保持 Interrupt，按情况保留 journal/恢复材料。Effect 4.0.6 中，嵌套 acquireUseRelease 被真实 Fiber.interrupt 中断时，外层 Cause 可能只保留 Interrupt 而遗漏附加 finalizer 失败。因此 recovery-required 的锁/rename finalizer 在结束前通过 Effect Logger 记录结构化诊断；CLI/daemon 使用 stderr 日志保护 JSON stdout。普通失败保留 typed error/结果。不承诺每次中断携带完整清理 Cause，也不把 journal 称为通用事务或原子目录发布。

[English](../en/006-SERVICES-AND-EXTENSION-LIFECYCLE.md) | [中文](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)
