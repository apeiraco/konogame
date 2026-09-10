# ADR 0005：Location 注册与核心 Workspace 持久化

> 协议更新：[ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 将当前 Contract 协议改为 `0.2.0`、范围 `>=0.2.0 <0.3.0`。下文原始版本示例保留决策当时事实，发布版本归属与 Location/Schema 规则继续有效。

状态：于 2026-10-17 采纳。仅取代 ADR 0002 中内建 Location 分支及 filesystem Extension 拥有 Workspace 持久化的决策；其 TOML、身份、Unicode 布局、覆盖与重命名决策继续有效。补充 [ADR 0004](0004-LOCAL-DISCOVERY-AND-INJECTION.md)。

后续细化：[ADR 0006](0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)将注册表移至 core，依赖失败保留为目录诊断/受阻激活，以 manifest 发现和有作用域惰性激活取代直接运行注册。下文 Location 封装、版本、兼容检查及核心持久化归属继续有效；注册执行细节描述此前切片。

## 背景

安装既可能指向文件系统目录，也可能指向没有路径的资源。Workspace 需要保留陌生配置，并准确报告其可用性。厂商行为与 Workspace 元数据持久化需要明确归属，执行继续使用同一绑定流程。

## 决策

Workspace Schema 为 `workspace.experimental.4`，Location 唯一表示是公共可序列化值对象 `{ type, schemaVersion, data }`。通用 Schema 校验封装和 JSON/TOML 共通值，不枚举文件系统或托管类型。不提供 Schema 3 读取器、迁移或私人配置改写。未知类型、不支持的位置 Schema 版本仍可读取、展示并按原值保留，校验为 `unverified`，解析为 `unavailable`；不合法的通用封装仍报错。

`ExtensionRegistry` 注册类型定义，配置实例不属于注册项。每个定义声明稳定 `type`、`schemaVersion`、兼容 `schemaRange` 与可移植 `dataSchema`。注册接受 Standard Schema 或 JSON Schema，并保存 JSON Schema 形式，不依赖 Schema 库对象。类型受支持不等于数据已校验或可以执行。Extension 注册检查重复 ID/类型、Contract 兼容性、显式依赖的版本与循环。Extension 可以复用其他 Extension 的服务；Steam 可以通过显式且经过校验的依赖复用 filesystem 服务。

`AdapterRegistry` 注册描述与类型化运行实现。兼容条件包括 owner、Contract 范围、Operation、必需 Capability，以及每个 Location 的类型/Schema 范围。比较必须同时支持两侧。仅有描述、没有激活运行实例时不能执行。实现访问要求该注册表实际签发的绑定；JSON 计划只描述决策，不是执行句柄。不引入额外 Provider 注册表、动态安装/下载机制或隔离 Extension 加载器。

`location.behavior` Port 提供可选 `validate`、`compare`、`resolve` Operation，对应 `location.validation`、`location.identity`、`location.resolve` Capability。应用 `LocationBehaviorService` 对每次操作先绑定，再访问运行实现。比较可返回 `equal`、`different`、`unknown`、`incomparable`，缺失行为不能伪造相等或不同。解析返回类型化资源引用或 `unavailable`，不要求路径。Core 不通过路径字符串或 JSON 编码建立 Location 等价性。Host roots 作为相关 Adapter 的上下文，core 不解释其文件系统语义。

filesystem Extension 拥有 `fs.absolute`、`fs.relative`，负责其校验、比较、解析及原生发现 I/O。位置 Schema `1.0.0` 独立于 Contract 协议 `0.1.0` 和 Extension 发行版本 `0.1.0-alpha.0`。文件系统行为处理 Windows 大小写与相对根限制；解析路径不验证存在性，也不启动游戏。其他类型需要各自定义及兼容行为。

核心 `@konogame/workspace-configuration` 拥有 TOML 编解码、元数据布局、UUID/name 投影、读取、重命名、追加录入与恢复算法。`core.workspace-configuration` 通过 `owner: { kind: "module", id: "konogame.workspace" }` 属于 `konogame.workspace` Module；Extension Adapter 使用 `owner: { kind: "extension", id: ... }`。Adapter 描述与绑定中的 `extensionId` 被此字段替代。新核心包使用统一 core 发行版本 `0.1.0-alpha.0`；Extension 继续独立版本。不创建伪 core Extension。读取配置不依赖 filesystem Location 注册。

已有 Node 读取/重命名 transport 随算法移动；录入 transport 使用可注入的 `WorkspaceImportFileSystem` 边界。这不表示全部配置 transport 已完成抽象。重命名与录入保留共享写入协调、修订/哈希检查及各自回滚/前向恢复语义。

## 录入与恢复

候选和安装共享 Location 封装。应用发现、候选之间、与已有安装之间及新录入的检查均通过绑定校验/比较。新录入要求位置有效且可比较；不可用比较明确保留，不能绕过去重/冲突检查。检查输出原始 Location、validation、availability 与 Binding Plan，不要求 `resolvedPath`。

Pending import 恢复通过已有 journal/receipt 完成先前批准的配置元数据，不访问或执行 Location 资源，因此不要求 filesystem Location 注册。已有 journal/哈希检查、共享锁、前向恢复、外部改动失败和跨文件创建不原子的语义继续有效。恢复不录入新预览，也不成为通用事务引擎。

## 影响

陌生位置在检查和无关元数据操作中保持原值，资源操作明确说明不可用原因。持久化与位置行为可以独立演进。测试覆盖定义或实现缺失或不兼容、比较两侧、非路径资源、未知值保留及缺少位置注册时的恢复。参见 [Location 指南](../005-LOCATION-AND-REGISTRIES.md)、[架构](../001-ARCHITECTURE.md)与[开发指南](../004-DEVELOPMENT.md)。

[English](../../en/adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md) | [中文](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)
