# 07 Extension 系统：源码对照与后续工作

状态：实现对照，2026-10-18。本文依据已核对的源码版本，列出此前 Konogame 切片的具体不足与 [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)采纳的补全，不承诺 VS Code/Theia API 兼容。

## 证据与改动

参考版本：VS Code `60541952313cbc2728cab30dacddf4154e5b10c9`，Theia `046af0812516f46f2bf7ce3357cca0b672159b20`。下列链接固定到这些版本；分析只读源码，没有安装或构建参考项目。

| 关注点与源码证据 | 此前 Konogame 不足 | 本轮实现 |
| --- | --- | --- |
| VS Code 使用前校验 manifest 字段、依赖列表和激活事件：[extensionValidator](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/extensions/common/extensionValidator.ts#L242)。 | 关系检查不能证明所有嵌套声明结构有效，异常 source 条目可能突破故障隔离。 | 在关系检查或 loader 前严格校验 Contribution、Extension/Module/Feature/Adapter、software、依赖、事件及 Location Schema；拒绝未知字段，对坏 source 结果/条目（含稀疏数组）安全诊断。 |
| VS Code 先重建索引、递增版本再通知观察者：[extensionDescriptionRegistry](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/extensionDescriptionRegistry.ts#L103)。 | 公开注册订阅可能看到 Extension/Adapter 不同修订，或在更新中途重入。 | 内部 Symbol 提交先同步两注册表索引/snapshot，再公开通知；`catalogVersion` 关联快照与结果。公开流只观察提交结果，不驱动同步。 |
| VS Code 从贡献推导激活：[implicitActivationEvents](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/platform/extensionManagement/common/implicitActivationEvents.ts#L14)；新增声明重放既有需求：[abstractExtensionService](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L406)。 | 迟到 Module Feature/Location 定义可能无法匹配已有 inactive 贡献，局部请求键可能覆盖不同完整需求。 | 目录变化重算已记忆事件和默认最近 256 个不同完整绑定请求；显式事件保持原行为，贡献推导仅激活选中兼容 Adapter。请求缓存相等不用于资源身份比较。 |
| VS Code 共享激活操作：[extHostExtensionActivator](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/api/common/extHostExtensionActivator.ts#L217)；Theia 区分真正插件激活：[plugin-manager](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/plugin/plugin-manager.ts#L314)。 | 同步观察者可能在生命周期完成句柄登记前重入；准备目录也会启动激活。 | 可重入观察前先用原生 Deferred/Fiber 共享完成状态；`prepare` 只准备目录，`initialize` 才加入 startup。保留每代激活共享、依赖/等待循环诊断与暂存运行发布。 |
| Theia 区分目录枚举、JSON 元数据和运行入口读取：[本地目录 resolver](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/main/node/resolvers/local-directory-plugin-deployer-resolver.ts#L36)、[JSON 包读取](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext-vscode/src/node/plugin-vscode-directory-handler.ts#L120)、[plugin reader](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/hosted/node/plugin-reader.ts#L140)。 | 只有内置/注入声明，没有真实已安装包发现来源。 | 新增随 core 统一版本的 `@konogame/extension-discovery-node`，仅读取显式 roots 下的严格 JSON，激活才 ESM import/调用 factory；以路径锚定、字节/数量限制、revision 和 loader 复查报告坏包/变更。Core 不依赖文件系统实现。 |
| VS Code 提供 contribution-point schema/generator 与 delta 处理：[extensionsRegistry](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/extensionsRegistry.ts#L675)。 | 未建模 source 身份、不完整扫描和 refresh 归属。 | 稳定 source ID 与带完成标记/诊断的 `DiscoveryBatch` 支持真正 add/unchanged/replace/remove 差异；失败/不完整扫描不删除旧项。CLI 提供目录 list/status/refresh，通用贡献点扩展留待后续。 |
| Theia 限制优雅停止等待，且可终止独立进程：[plugin-host](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/hosted/node/plugin-host.ts#L109)、[hosted-plugin-process](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/plugin-ext/src/hosted/node/hosted-plugin-process.ts#L123)。 | 不结束的 discover/load/activate/cleanup 可能阻止关闭，并隐藏清理不完整。 | 取消及可配置阶段截止时间限制异步等待，封闭激活上下文、禁止迟到发布、消费迟到拒绝并提供阶段诊断；单项失败后继续清理并诊断未完成项，受协作式 Scope 释放限制。Konogame 没有独立 host 或进程强杀。 |
| Theia 区分 root/child contribution container：[contribution-provider](https://github.com/eclipse-theia/theia/blob/046af0812516f46f2bf7ce3357cca0b672159b20/packages/infrastructure/src/common/contribution-provider.ts#L86)。 | 既有作用域边界已满足当前需要。 | 使用 Effect 4.0.6 owner Context.Service tag、固定 root、按代原生 Layer/Scope、root 替身和已声明 active 依赖 Context，不引入 Theia 容器框架或第二服务注册表。 |

进程内 Location `dataSchema` 可显式提供 Standard Schema，其求值/转换可能调用 Schema hook，包括约定的 getter 接口。普通声明严格校验不是不执行代码或 sandbox 保证；外部 Node 包元数据为纯 JSON，没有可执行 Schema hook。

本机实现见[严格契约 Schema](../../packages/contracts/src/manifest.ts)、[目录校验](../../packages/infrastructure/src/manifest-validation.ts)、[注册表](../../packages/infrastructure/src/registry.ts)、[生命周期/refresh](../../packages/infrastructure/src/lifecycle.ts)、[激活](../../packages/infrastructure/src/activation.ts)及 [Node 发现](../../packages/extension-discovery-node/src/source.ts)。合成测试覆盖错误输入、观察者重入、迟到声明、待完成任务及安装包变化；完整仓库验收随实现工作记录，不从参考项目推断测试结论。

## 安装包与目录操作

配置 `LocalApplicationCompositionOptions.extensionRoots`，或设置 `KONOGAME_EXTENSION_ROOTS` 为不重复绝对路径的 JSON 数组。未配置 roots 就不扫描已安装包，不隐式搜索 home 或 node_modules。每个 root 的直属包目录可包含 `konogame-extension.json`：

```json
{
  "schemaVersion": "extension.package.1",
  "manifest": {
    "id": "example.demo",
    "version": "0.1.0",
    "contractRange": ">=0.2.0 <0.3.0",
    "software": { "node": ">=26" },
    "activationEvents": ["onStartup"],
    "contributes": {}
  },
  "module": {
    "entry": "./dist/extension.mjs",
    "factory": "createExtensionModule",
    "options": { "label": "Synthetic example" }
  }
}
```

命名 factory 接收 `options` 并返回 `ExtensionModule`，选项采用公共可序列化值子集。Entry 是无越界、反斜杠或 URL 组件的 `./` 相对路径，规范路径/realpath 必须保持锚定。清单上限 1 MiB，扫描最多 256 个包目录候选，稳定排序且逐包诊断。发现对清单字节与流式入口计算 SHA256，revision 还包含锚定路径；loader 导入前重新观察。这些检查检测变化，不是签名、完整依赖树摘要或原子文件系统/导入事务。

```sh
just cli extension list --json
just cli extension status example.demo --json
just cli extension refresh --json
```

上述命令使用 `catalogOnly: true`，不触发 startup 或执行包代码，包括显式声明的 `onStartup`；正常业务初始化仍尊重启动事件。CLI 是短命进程，refresh 只重扫该次调用的运行时，不持久化管理决策。长期调用方通过 返回 Effect 的 Extension 管理服务 或 `ExtensionLifecycle.refresh(sourceId?)` 应用真正目录差异；`list` 与 `status(id?)` 提供目录/运行/诊断状态。

Manifest/revision 未变不创建新代；不完整扫描、诊断或要求重启的观察不授权删除未发现的旧项。来源冲突不悄悄覆盖另一来源；active/activating 变更，以及 `restart-after-load` 策略下已尝试加载的安装代码要求重启。Node ESM 缓存属于进程，仅添加 URL query 或替换贡献无法使已尝试的变更代码成为新代码；进程/服务重启边界必须真正释放该代码环境。

## 等待与关闭保证

原生 Effect Clock/Fiber/Scope 提供协作式 discovery/load（各 15 秒）、activation（30 秒）、shutdown（总 5 秒）与 cleanup（各 1 秒）预算。`coreOptions.budgets` 与 `demandCacheLimit` 是普通设置，测试替换 owner Layer 并使用 TestClock。业务 Port 不接受 AbortSignal，真实外部桥接使用 Effect 取消。封闭迟到发布并诊断未完成清理。

截止不能强制终止同步/不让出或刻意不可中断的工作，不能 sandbox 导入代码或保证所有资源已释放。Effect 4.0.6 的嵌套 acquireUseRelease 在真实 Fiber.interrupt 下可能使外层 Interrupt Cause 遗漏附加 finalizer 失败。Recovery-required finalizer 在结束前记录结构化诊断，CLI/daemon 日志写 stderr。参见[生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)与 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。

## 明确后续工作

| 能力 | 实施时机与原因 |
| --- | --- |
| 持久化启停与全局/Workspace 策略 | 用户需要跨会话重复选择时，先定义优先级、存储及运行代码变化策略；当前目录变更仅在内存。VS Code [enablement 处理](https://github.com/microsoft/vscode/blob/60541952313cbc2728cab30dacddf4154e5b10c9/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L1453)仅供参考，尚非 Konogame 能力。 |
| 通用第三方贡献点 | 出现具体第三类贡献，需要注册、校验和激活语义时再做；当前 `adapters`/`locations` 保持有限。 |
| Marketplace/下载/安装 UI | 有真实分发流程时，设计信任、版本选择及文件系统发布；目录 refresh 不是安装。 |
| 文件系统 watcher | 长期会话需要自动发现变化时，先定义去抖、部分写入和冲突行为，再替代显式刷新。 |
| 独立 host/RPC/远程执行 | 需要故障隔离、抢占终止或远程部署时，需要明确进程/协议及资源归属契约。 |
| 热卸载或仅重启 Extension | Host 边界可以可靠释放代码、依赖作用域和资源后再做；当前 ESM 缓存和 active 依赖要求重启，不提供虚假卸载保证。 |

本轮不改变 Workspace Schema 4、录入/恢复、流式 Artifact 或私人游戏数据。路线决策见[初始迭代](roadmap/001-INITIAL-ITERATIONS.md)及[前端提案](roadmap/004-FRONTEND-EXPERIENCE.md)。

[English](../en/007-EXTENSION-SYSTEM-COMPARISON.md) | [中文](007-EXTENSION-SYSTEM-COMPARISON.md)
