# ADR 0011：Effect 契约、组装与生命周期

状态：已接受，2026-10-26。

## 背景

异步 Port、流归属、动态 Extension 激活与 writer 恢复需要统一的类型化依赖/错误/并发模型。此前显式 injection-js/RxJS 与应用句柄设计将归属拆散在 provider、callback、Promise 和自制取消之间。本次完整 Effect 改造在本地实验阶段有意打破这些 API。

## 决策

`effect`、`@effect/platform-node`、`@effect/vitest` 在 pnpm 默认 catalog 中精确固定为 4.0.6，采用实际 `Context.Service` API。Owner tag 和原生 Layer 替代 InjectionToken/provider 数组、自制 Env/应用上下文及重复服务注册表。类继续封装有状态算法，Schema/值/解析器/规则保持纯。

有副作用 Port、Adapter、工作流返回带 owner 具名错误的 `Effect<Success, Error, Requirements>`。Artifact 文件集合与字节使用原生 Stream，在 Scope 中按需打开，不缓冲完整资产。Promise 转换与 runMain/runPromise/框架 FiberSet 桥接仅位于真实进程、外部框架/import/I/O 与测试边界。业务 Port 不携带 AbortSignal。

`composeApplication`、`composeLocalApplication` 返回完整原生 Layer。根组装不选择 Extension，本机组装选择内置纯 `/providers` source 与显式安装根。Owner Layer 替身进入固定 root 图。Catalog-only 获取仅准备目录，默认获取完成 startup 后暴露应用服务。业务流程归 application 且不导入 composition；Core 拥有通用 `LocationBehaviorService`/`LOCATION_BEHAVIOR`。

Core root 组装保持单个原生 `Layer.effectContext`。访问器类型为 `Effect<Context<InfrastructureServices>, InfrastructureError>`，通过 Deferred.poll 读取：构造期间提前访问立即返回 Providers 阶段错误，不等待或暴露尚未赋值完整的上下文。完整服务图与生命周期 finalizer 安装后才完成 Deferred；后续读取共享固定 Context 与 root 替身。仅在已验证的动态 Extension 执行边界擦除 requirements。参见[core 组装](../../../packages/infrastructure/src/providers.ts)与[root 访问测试](../../../packages/infrastructure/src/__tests__/providers.test.ts)。

ExtensionModule 提供可选原生 layer（或接收激活上下文的 Layer 工厂）与 Effect activate。每代拥有 Scope 和构建后的服务 Context，显式 root 替身优先；dependencyServices 仅可访问已声明 active 依赖 Context。严格声明校验、双注册表原子目录提交、惰性绑定、暂存运行发布、按代完成/失败缓存、缺失/版本/循环重评、重放/刷新归属与 restart-after-load 约束保持。私有 PubSub 暴露只读 Stream 观察和 snapshot，观察者不驱动注册表同步。

可协作的自定义 Extension cleanup 推荐使用 [addLifetimeFinalizer](../../../packages/infrastructure/src/services.ts)，通过原生 Scope finalizer 应用 interruptible 单项/剩余总预算而不建立第二执行器；普通 acquireRelease/addFinalizer 和库资源 release 保留原生 Scope 的中断保护，因此 1 秒/5 秒不是通用硬截止，中断不能证明句柄已关闭。

原生 Scope/Fiber/Deferred/Clock 拥有清理、取消与截止。默认 discovery/load 15 秒、activation 30 秒、总 shutdown 5 秒、单 cleanup 1 秒。这些预算是协作式的：同步/不让出代码、刻意不可中断 Effect 和不可取消外部操作可能超时。不引入自制游离清理 scheduler、fiber 内部补丁或同进程 sandbox。

Filesystem 存档发布采用内部 Windows-only 原生 rename EPERM 重试策略：最多五次总尝试，可取消退避 25/50/100/200ms（累计 375ms），以 Clock 从 helper 入口计时的 500ms 软预算仅约束后续重试启动，在等待/目标检查后及后续 rename 前复检。首次尝试始终允许，包括初次 lstat 较慢时。每个原生 rename 窄范围屏蔽中断并等待 settle，可能超过预算。每次 lstat 预检目标，已有目标立即失败，非 ENOENT 检查错误不重试。耗尽保留 SaveError/原生 cause，不重放 Artifact 输入、不生成新 ID、不重新复制或删除目标；失败清理只移除自己的 staging。预检存在 TOCTOU，并非原子 no-replace 或通用事务；已观察的 EPERM 根因未知。参见[发布 helper](../../../extensions/filesystem/src/publication.ts)。

Workspace read/rename/import/initialize/edit/recovery 保持 Schema 4、TOML/布局/注释、UUIDv7/uniformName/unicode-fs-v1、source 与 Location 不变量，以及新鲜 root/revision/evidence/binding 检查和定向 journal。Writer 锁归 Scope，仅释放自己的锁。最小原生文件系统发布可屏蔽中断直到该单步完成。恢复完成批准元数据，不执行 Location；这不是通用事务或原子目录发布。

取消保持 Interrupt。Effect 4.0.6 中，嵌套 acquireUseRelease 被真实 Fiber.interrupt 中断时，外层 Cause 可能遗漏附加 finalizer 失败。Recovery-required 的 rename/锁 finalizer 先发出结构化 Effect Logger 诊断，CLI/daemon 用 Logger.LogToStderr 保护 JSON stdout。普通错误保留 typed channel/结果。Journal 和日志是关键恢复证据，不承诺每次中断都传播完整清理 Cause。

Port/Artifact/Extension API 破坏要求 Contract 协议升为 `0.2.0`、范围 `>=0.2.0 <0.3.0`。Core 共享版本与独立 Extension 发布版本仍为 `0.1.0-alpha.0`。`konogame-metadata.toml` 保持真源，release sync 生成投影。Schema 4 与 `extension.package.1` 数据布局不变，不添加历史迁移或旧 Promise/DI 兼容门面。

Effect/时间相关测试使用 owner Layer 替身、`@effect/vitest` 与 TestClock，纯测试保持纯。保留 unit/integration/e2e 分类、真实产物流程、所有者端口或真实目录的文件测试、temp/tests、Turbo 前置与源码 export condition。完整仓库验证独立于定向包测试，本决策不声称已完成完整 check。

Effect 行为测试通过 `@effect/vitest` 的 `it.effect` 返回 Effect，以 TestClock 控制时间并用真实 Fiber/Scope 验证取消。原生文件系统和 live-clock 集成测试使用 `it.live`，不要默认冻结它们的时钟。已知失败用 `Effect.flip`、Exit/Cause 和 owner tag/issue 断言，不为每个测试包 runPromise。纯 Schema/解析器/值/类型测试保留普通 Vitest，不为统一把纯工作包成 Effect。Promise 桥仅保留在真实外部 I/O、框架/进程和夹具边界，物理夹具清理由一个 Scope 或 hook 拥有。

已知 Schema/规则拒绝使用结构化 owner tag/issue；applicationRule/configurationRule 把已识别对象保留为 Fail，可信代码未知 throw 保持 Die。UnexpectedBoundaryError 仅用于明确的第三方边界，不使任意 Extension/Schema 行为变得可穷尽。WorkspaceConfigurationError 包含已知 Schema/规则错误、文件系统/配置输入/writer 冲突与恢复数据协议、明确边界错误及新录入的 LocationError；实现类及原生 code/cause 保持原 owner。Cause-aware 结果处理不能把 Die/Interrupt 转为普通流程 status。参见[开发错误指南](../004-DEVELOPMENT.md#类型化规则失败与缺陷)。

## 影响与继任范围

ADR 0004、0006、0007、0009 保留原历史正文。本 ADR 继任其 DI、异步观察、组装句柄与生命周期机制，领域边界和包归属继续适用。ADR 0002、0005、0008 的 Schema/Location/绑定/录入/恢复规则与 ADR 0010 的测试/任务图约束继续有效。

当前 API 参见[架构](../001-ARCHITECTURE.md)、[开发指南](../004-DEVELOPMENT.md)、[服务/生命周期指南](../006-SERVICES-AND-EXTENSION-LIFECYCLE.md)、[infrastructure Layer](../../../packages/infrastructure/src/providers.ts)与[激活契约](../../../packages/infrastructure/src/types.ts)。CLI 组装见 [apps/cli/src/main.ts](../../../apps/cli/src/main.ts)，daemon 组装见 [apps/daemon/src/main.ts](../../../apps/daemon/src/main.ts)。

[English](../../en/adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md) | [中文](0011-EFFECT-CONTRACTS-AND-LIFETIME.md)
