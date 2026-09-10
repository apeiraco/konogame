# ADR 0007：Extension 发现与加载稳健性

> 继任说明：[ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 以 Effect 4.0.6 替代本文的依赖注入、异步 Port、观察、组装与生命周期细节。本文保留原日期的决策记录，其余领域与归属约束继续适用。

状态：于 2026-10-18 采纳。细化 [ADR 0006](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)的发现、目录发布与生命周期完成行为；服务归属、固定 root/按代 child 注入、依赖作用域和暂存实现发布继续有效。源码证据及剩余不足见[对照报告](../007-EXTENSION-SYSTEM-COMPARISON.md)。

后续决策：[ADR 0009](0009-APPLICATION-COMPOSITION.md)曾替代历史组装名称，该组装包后来退役。用例放在拥有该能力的模块，CLI 与 Daemon 各自组装 Layer。下文旧名称保留当时已接受决策的记录；生命周期与 LifetimePolicy 术语仍有效。

## 决策

关系检查或执行前完整校验 Contribution 和 Extension/Module manifest，Feature、Adapter、software、依赖、支持的激活事件和 Location 定义均有严格边界。拒绝未知字段和错误值，不修改已接受目录、不调用 loader。独立且安全地诊断坏发现结果及错误条目；有效核心 Module 声明无法登记时仍使准备失败，错误条目不能冒充核心 Module 突破隔离。进程内 Standard Schema dataSchema 仍是显式可执行 hook 边界，普通声明拒绝 getter 不表示 Schema 被动求值或隔离；安装 JSON 元数据没有此类 hook。

ExtensionRegistry 在公开通知前内部提交目录变更。私有 Symbol 同步路径先更新 AdapterRegistry 索引和两侧不可变 snapshot；公开 `state$`/`results$` 只用于观察，不作为同步钩子。快照/结果的 `catalogVersion` 标识已提交目录，观察者重入时描述、代和版本必须一致。目录变化重算已记忆激活事件及有界不同完整绑定请求，包括迟到 Module/Location 声明；默认保留 256 个请求，缓存相等绝不定义 Location/资源身份。

发现 source 有稳定 ID，接收 `{ signal }`；`DiscoveryBatch` 声明 `complete`、贡献、可选诊断和要求重启的 ID。贡献可声明 revision 与 `restart-after-load` 策略。生命周期 `refresh(sourceId?)` 按来源归属计算 add/unchanged/replace/remove 差异，manifest/revision 未变则保留代。不完整/错误/要求重启的扫描不删除未观察到的旧项，合法新增/更新仍可应用。冲突不建立隐式来源优先级；active/activating 变更保留旧贡献并报告重启要求。

`prepare()`/`prepared` 只发现并登记目录，`initialize()`/`ready` 才加入启动激活。绑定可在准备后请求实现，不隐式触发 startup。任何同步观察者重入前先共享生命周期/激活完成 Promise；保留每代激活共享及 AsyncLocalStorage 等待循环检测。

`InfrastructureSettings` 用普通 budget/scheduler 选项配置默认 discovery/load 各 15 秒、activation 30 秒、总 shutdown 5 秒、单 cleanup 1 秒。Discovery/load 和 activation 接收取消信号。截止或关闭封闭上下文，阻止迟到注册并观察迟到 Promise 拒绝。逆序清理在单项失败后继续，结构化诊断包含阶段、可确定的 source/贡献/代、原因/cause 和耗时。总关闭超时报告未完成/未开始的清理，dispose 拒绝，不声称已完整释放。这些是有界异步等待，不是同步抢占、进程隔离或 sandbox。

新增随 core 统一版本的 `@konogame/extension-discovery-node` 作为可替换 Node 实现，core 不导入它。仅扫描显式不重复绝对 roots 的一层目录，不默认发现 home/node_modules。`LocalHostOptions.extensionRoots` 与前端 `KONOGAME_EXTENSION_ROOTS` JSON 数组配置 roots。仅读取数据型 `konogame-extension.json`，使用严格 `extension.package.1` 封装，含 manifest 与 module `{ entry, factory, options? }`；options 使用公共可序列化子集。清单上限 1 MiB，候选包最多 256，确定性排序并逐项诊断。

规范路径/realpath 锚定及相对入口校验约束包路径；revision 含清单字节、流式入口哈希及锚定路径，惰性 loader 在 ESM import 和调用 factory 前重新观察。这些只检测变化，不承诺认证签名、完整依赖摘要或对任意文件系统竞争的原子保护。Node 已尝试的 ESM 代码由进程缓存，包括失败 import；变更已加载/尝试的包要求真正服务/进程重启，不采用 URL query 热重载技巧。

公开 Extension 目录 `list()`、`.status(id?)`、`.refresh(sourceId?)`，及只准备目录的 CLI `extension list`、`extension status [id]`、`extension refresh`。目录模式不触发 startup 或执行已安装包代码。CLI 是短命进程，不持久化刷新决策；长期生命周期调用方应用真正差异。正常业务运行创建仍执行启动初始化。运行选项增加 `catalogOnly` 和 `coreOptions`，目录模式返回的 `ready` 表示准备完成，不代表启动完成。

## 影响与范围

系统增加明确的已安装包来源和运行诊断，同时保持注册表、来源 I/O、激活及绑定的区分。既有 Schema 4、未知 Location 保留、元数据恢复和游戏数据边界不变。合成测试覆盖无效声明、目录重入、迟到重放、取消/截止时间、清理不完整、包 revision、扫描失败及惰性导入。

持久化全局/Workspace 启停、通用第三方贡献点、marketplace/下载/安装 UI、watcher、独立 host/RPC/远程执行、强杀及热卸载属于后续工作，待具体选择、分发、隔离或长期会话需求确定策略和协议后实施。同进程截止时间不能宣传为杀死不合作代码。准确 API、证据及后续触发条件见[生命周期用法](../006-SERVICES-AND-EXTENSION-LIFECYCLE.md)与[对照报告](../007-EXTENSION-SYSTEM-COMPARISON.md)。

[English](../../en/adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) | [中文](0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)
