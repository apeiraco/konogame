# 03 发布元数据与维护

`konogame-metadata.toml` 是项目信息、Core 版本、Contract 协议版本/兼容范围、受管包清单和独立 Extension 版本的真源。package manifest 与生成的运行时 metadata 由 dev-cli 维护投影。release 命令处理本地文件；软件包仓库发布和 Git tag 属于后续交付工作。

## 版本与兼容性

所有 Core 可执行程序与包共享 `project.version`：仓库根、contracts、Workspace、Save、application、应用组装、CLI、Daemon 和 dev-cli。每个 `[[extension]]` 独立维护 `version`；Core 升版不会修改 Extension 版本。初始版本号相同，不代表发布节奏绑定。

Contract **协议**为 `0.2.0`，与软件包发行号分开。Core 和内置 Extension 声明 `>=0.2.0 <0.3.0`，因此 npm 包 `@konogame/contracts@0.1.0-alpha.0` 与其描述的协议版本是两件事。Module 与 Adapter 声明 `contractRange`，解析时先用 SemVer 检查当前协议是否在范围内，再执行操作。Binding Plan 保留实际 `contractVersion` 和选中 Adapter 的范围。非法或不兼容范围不可用，显式偏好不会回退。预发布协议版本必须按普通 SemVer 规则由范围显式接纳。 Effect Port/Artifact/Extension API 的破坏性变化要求协议升版；core 与 Extension 发布版本仍为 `0.1.0-alpha.0`。不提供旧 Promise/DI 兼容层；Schema 4 与 `extension.package.1` 数据布局不变。参见 [ADR 0011](adr/0011-EFFECT-CONTRACTS-AND-LIFETIME.md)。

Extension 对应软件的兼容性直接写在自己的 `software` 映射中，取值为：

| 值 | 含义 |
| --- | --- |
| SemVer 范围，例如 `>=26` | 声明的软件或运行时约束。 |
| `latest` | 软件版本尚未固定或测试不足，不表示所有版本都兼容。 |
| `generic` | 面向协议或格式，不绑定软件发行号。 |

当前仅实现 filesystem Extension，其软件声明为 Node.js `>=26`。未来 Steam Extension 可填写 `software = { steam = "generic" }`；Epic、Kopia Extension 在明确测试范围前可分别填写 `software = { epic = "latest" }`、`software = { kopia = "latest" }`。这些只是填写示例，不会注册 Extension，也不引入新架构概念。一个 Extension 可以声明多个软件约束，并贡献多个 Adapter。

`latest` 和 `generic` 仅用于软件声明，不能作为 Contract 范围。本轮没有自动探测外部软件版本或安装软件的功能。

## 维护命令

先构建 dev-cli，再检查或维护真源：

```sh
just build
just dev-cli release show
just dev-cli release check
just dev-cli release sync --dry-run
just dev-cli release sync
just dev-cli release version 0.1.0-alpha.1 --dry-run
just dev-cli release version 0.1.0-alpha.1
just dev-cli release version 0.1.0-alpha.1 --extension konogame.filesystem
just dev-cli release notes --lang zh
just dev-cli release notes --extension konogame.filesystem --lang en
```

`just build` 转发到 `pnpm build`。`just dev-cli` 运行已构建的 Node 工具，并把参数作为原生 argv 转发。`pnpm build` 和 `pnpm dev-cli` 仍可供该范围和 agent 直接调用。

`--root` 可指定另一个 checkout 或一次性测试目录。结构化命令输出 JSON；notes 输出 Markdown，也可用 `--json` 输出结构化结果。导入模块不产生启动副作用。version/sync 写入前校验所有输入、检查期间是否有文件改动，并在普通失败时尝试回滚；它们不提供 Workspace rename 的崩溃恢复事务，因此维护过程被中断后需要检查 Git diff。TOML 注释和 manifest 的其他字段会保留。

发布 Core 时，设置版本、完成中英文对应版本的 changelog 小节、重新构建并运行 `just check`。发布 Extension 时，通过 `--extension` 指定其 ID，Core 和其他 Extension 的版本独立推进。调整兼容性声明时，显式修改 metadata，再执行 `release sync`。sync 更新全部已登记投影；version 只更新选中的发布组。改版后重新构建，才能让可执行程序显示新 manifest/常量中的版本。

`release check` 检查包遗漏/未登记、manifest 与生成源码漂移、非法/不兼容 Contract 范围、非法软件标记、英文 changelog 投影，以及每种声明语言中缺失的版本说明。`just check` 转发到 `pnpm check`，后者在构建、类型检查、测试和文档检查后运行该检查。

## Changelog 真源

英文真源为仓库根 [CHANGELOG.md](../../CHANGELOG.md)，通过相对符号链接投影到 `docs/en/CHANGELOG.md`。[中文真源](CHANGELOG.md) 为普通翻译文件，两份内容同步维护，不复制英文真源。

Core 小节标题使用 `## <version> - <date>`；同一 changelog 中 Extension 的小节使用 `## <extension-id>@<version> - <date>`，让初始版本号相同时仍能独立提取发布说明。`Unreleased` 收集后续变化。version 命令不会编造或翻译发布说明；每种语言都必须完成准确版本的小节，release check 才能通过。

[English](../en/003-RELEASE-MAINTENANCE.md) | [中文](003-RELEASE-MAINTENANCE.md)
