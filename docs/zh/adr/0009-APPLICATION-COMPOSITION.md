# ADR 0009：应用组装包与入口

> 现行指向：用例放在拥有该能力的模块。CLI 与 Daemon 各自合并这些 Layer。多个跨 Feature 组合确实无法由现有模块承接时，才增加 `packages/layer-composition`。[ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 仍是 Effect 契约。本文保留原日期的组装包决策。

状态：已接受，2026-10-19。更新 [ADR 0002](0002-WORKSPACE-TOML-AND-TOOLING.md)、[ADR 0006](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md) 和 [ADR 0007](0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md) 中应用组装的包路径与 API 命名。原有生命周期、服务归属及安装发现决策继续适用。

## 背景

`apps/shared` 为多个应用组装依赖。目录位置把可复用组装当作应用，包名描述宽泛执行概念，未表达其职责。纯核心入口与本机入口的名称也未直接说明哪个入口选择本机 Extension。应用业务编排已经归 `packages/application`。

## 决策

将共享依赖组装迁至 `packages/application-composition`，包名为 `@konogame/application-composition`。目录与包名遵循现有对称约定，表达 composition root 的职责：组装所属包的 provider、发现来源和选项。它不新增业务层、Module、Port、Provider 注册表或服务归属体系。

根入口 `src/index.ts` 导出 `composeApplication`、`ApplicationCompositionOptions` 和 `ApplicationContext`，组装核心 Module 与应用服务，不选择 Extension 或导入其实现。调用者可以显式提供 provider 与发现来源。`./local` 入口 `src/local.ts` 导出 `composeLocalApplication` 和 `LocalApplicationCompositionOptions`，选择内置 filesystem/Steam 来源，仅在显式提供 `extensionRoots` 时启用安装发现。本机选项在根选项上增加 `saveRoot` 和 `extensionRoots`；filesystem 存档根由组装方提供。

两个函数异步返回 `ApplicationContext`，即本次已组装应用的句柄：`{ injector, app, ready, dispose }`。默认完成包含初始化/startup；`catalogOnly` 仅完成目录准备，返回的 `ready` 也仅表示该准备。导入任一 ESM 入口不产生启动副作用，仅在调用函数时组装。CLI 和 daemon 仍是 `apps/` 下的进程边界，选择本机入口并负责启动和清理。

`apps/cli/src/context.ts` 定义单次 CLI 调用的 `CliContext`，由 `cliContextStorage` 传递并通过 `getCliContext()` 访问；该调用上下文包含交互/输出依赖与惰性应用访问。

依赖方向为 apps -> application composition -> 所属包。`packages/application` 继续通过 Port 与绑定协调业务流程，不反向导入 application composition。Core 继续拥有注册表、激活、生命周期和执行策略。`ExtensionLifecycle` 与 `LifetimePolicy` 表示代的生存期和清理预算。本决策调整应用组装命名。

## 影响

包位置和入口直接呈现依赖组装与本机选择。测试等调用者可选择根入口而不选择内置 Extension；CLI/daemon 显式选择本机组装。已有生命周期和目录行为保持。实验阶段删除旧包、`/core` 入口以及核心/本机组装别名，不提供兼容垫层。Schema 与发行版本不变。

[English](../../en/adr/0009-APPLICATION-COMPOSITION.md) | [中文](0009-APPLICATION-COMPOSITION.md)
