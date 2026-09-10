# ADR 0006：服务归属与惰性激活

> 继任说明：[ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 以 Effect 4.0.6 替代本文的依赖注入、异步 Port、观察、组装与生命周期细节。本文保留原日期的决策记录，其余领域与归属约束继续适用。

状态：于 2026-10-17 采纳。细化 [ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)的注册、依赖和激活行为；其 Location 封装与持久化归属继续有效。

后续细化：[ADR 0007](0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)增加严格声明/来源边界、公开观察前内部目录提交、仅目录准备、Node 安装发现及有界取消/清理诊断。下文此前 source/流/startup 细节属于历史记录，服务归属及按代作用域继续有效。

后续决策：[ADR 0009](0009-APPLICATION-COMPOSITION.md)曾替代历史组装名称，该组装包后来退役。用例放在拥有该能力的模块，CLI 与 Daemon 各自组装 Layer。下文旧名称保留当时已接受决策的记录；生命周期与 LifetimePolicy 术语仍有效。

## 背景

组装需要发现能力而不加载所有实现，服务、Port 和 token 需要清晰 owner，使应用入口只负责组装与启动。缺少 Extension 不应禁用无关能力，新增实现不应要求 root 预装服务。

## 决策

增加基础层 `@konogame/infrastructure`，依赖 contracts 与基础设施，不依赖业务 Module/Extension。它拥有注册表、激活、生命周期、绑定、Temporal/ID 服务及其 token/provider。领域包拥有领域 Port/token/provider，application 拥有应用服务/token，配置实现拥有其 I/O，Game 拥有发现 I/O。可替换且并存的 Adapter 使用独立实现 token。Apps 选择 source/provider 与参数，再启动及清理。

采用单个内部 multi 发现来源贡献流。Source 返回 manifest 与惰性 loader，manifest 声明 `activationEvents`、`contributes.adapters`/`contributes.locations`。需求发生前先登记所有已发现声明；AdapterRegistry 订阅声明成功结果，描述登记独立于激活。纯 manifest/provider 入口不导入运行实现。内置 filesystem/Steam 不声明 `onStartup`。

借鉴 VS Code 区分 manifest 和激活事件的方式，支持显式 `onStartup`、`onFeature:<id>`、`onPort:<id>`、`onLocation:<type>`，这是 Konogame 自身 API，不提供 VS Code API 兼容。显式匹配声明均受尊重；从贡献推导的需求只激活选中兼容 Adapter 所属贡献及依赖，避免激活全部候选。绑定变为异步，仍保持 Contract/Operation/Capability/Location 协商及显式偏好失败。

Loader 返回后，core 按贡献代创建原生 injection-js 子 injector。`ExtensionModule.providers` 是显式 provider 数组或上下文函数。Root 显式替身优先于 child 默认实现，不修改 root。`context.injector` 访问贡献作用域，`context.dependencyInjector(id)` 仅访问已声明且 active 的依赖作用域；Steam 通过 filesystem 作用域取得共享发现 I/O。Filesystem loader 调用 `createFilesystemExtensionModule`，传入组装方提供的 saveRoot，无需 root 预装，也不由 Extension 推断 home。不引入 loaded-cell 层或第二服务注册表。

激活的运行注册全部暂存，成功后统一发布；依赖先激活。同贡献/代的并发工作共享 Promise，代码失败在该代缓存，激活等待循环明确诊断。依赖缺失、版本不兼容或循环时，合法目录项保留，附诊断且激活受阻；目录条件修复后可重新评估。结构、标识、类型和 Adapter 冲突原子拒绝注册变更。生命周期隔离 Extension/source 失败；核心 Module 登记无效时中止初始化。

注册表和激活通过只读状态/结果 observable 与 snapshot 暴露私有 RxJS Subject/BehaviorSubject；生命周期公开只读状态和诊断。Promise 表达异步完成，订阅显式跟踪待完成工作，不使用 `async subscribe`。目录/描述登记后、启动激活前解决准备屏障，绑定等待 `prepared`，因此启动代码可以请求其他 Feature。入口等待包含启动事件处理的完整 `ready`。

生命周期支持运行期注册，ExtensionRegistry 支持安全 inactive 删除/替换。Active/activating 贡献或存在 active/activating 依赖者时返回 `restart-service-required`，保留当前状态。尚无独立 Extension host，也不提供仅重载 Extension。关闭时发出取消信号，等待已跟踪工作，逆序清理并关闭订阅。调用方可明确创建新进程，不提供自动重启。

## 入口与范围

核心与本机组装函数异步返回 `{ injector, app, ready, dispose }`；前者不导入 Extension，后者组装内置纯 provider 入口。CLI 在首次应用需求时才创建该组装：help/schema/version 不创建，features 发现声明并尊重显式启动事件，CLI 总会清理自己拥有的资源。Daemon 初始化后再监听，关闭/监听失败时清理。删除旧 `LOCAL_*` token 与 `create*Application` 辅助函数，不提供兼容垫层。

当前支持内置/注入 source、惰性代码加载、激活作用域、诊断和运行期目录管理；没有 marketplace/下载、外部磁盘安装扫描、安装 UI、独立 host 隔离或自动重启。Workspace Schema 4、审核录入、未知 Location 保留及已批准 journal 恢复不变，Core/Extension 发行版本不变。

## 参考

- [VS Code 激活事件](https://code.visualstudio.com/api/references/activation-events)与 [Extension manifest](https://code.visualstudio.com/api/references/extension-manifest)：声明和按需激活设计参考，核对于 2026-10-17。
- [RxJS BehaviorSubject API](https://rxjs.dev/api/index/class/BehaviorSubject)：可观察状态基础设施，核对于 2026-10-17。
- [服务/生命周期指南](../006-SERVICES-AND-EXTENSION-LIFECYCLE.md)：owner 表、真实源码链接与用法。

[English](../../en/adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) | [中文](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)
