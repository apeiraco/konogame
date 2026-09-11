# 05 Location 与注册表

本指南描述 Workspace Schema `workspace.experimental.4`。[ADR 0005](adr/0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)记录归属与兼容决策；[实验指南](002-WORKSPACE-EXPERIMENT.md)说明 CLI 审核和恢复。

## 编写安装 Location

以下完整合成安装记录需要对应 Game/Host ID、已有 configured `loose` 来源，并采用实验指南中的记录文件名/布局。相对位置由所属 Host 提供 `platform = "windows"` 与 `[roots] games = "C:/Synthetic/Games"`。

```toml
schemaVersion = "workspace.experimental.4"
kind = "installation"
id = "01900000-0000-7000-8000-000000000003"
uniformName = "Sample Game"
gameId = "01900000-0000-7000-8000-000000000001"
hostId = "01900000-0000-7000-8000-000000000002"
sourceId = "loose"
launchEntries = []

[location]
type = "fs.relative"
schemaVersion = "1.0.0"

[location.data]
rootKey = "games"
path = "Sample Game"

[settings]
```

绝对位置可将上述 location 表替换为：

```toml
[location]
type = "fs.absolute"
schemaVersion = "1.0.0"

[location.data]
path = "C:/Synthetic/Games/Sample Game"
```

filesystem Adapter 解释路径、校验根限制，成功解析返回 `filesystem.path` 资源引用，不证明目录存在。上下文 roots 不授予发现扫描权限。

## 保留陌生值

同一安装也可以包含这个合成未知类型：

```toml
[location]
type = "example.catalog"
schemaVersion = "2.0.0"

[location.data]
catalog = "sample"
key = "game-42"
```

Core 无需注册此类型即可读取封装并保留数据。检查输出保留原始 Location，报告 `validation.status = "unverified"` 与 `availability.status = "unavailable"`，附原因和 Binding Plan。已知类型使用不支持的 Schema 版本时行为相同。非法封装、null/日期及不安全数值会被拒绝。元数据检查/重命名与已批准导入 journal 的恢复不要求执行位置；新录入和资源操作需要兼容校验/比较或解析。

## 注册与使用行为

[契约](../../packages/contracts/src/location.ts)定义封装、可移植类型定义、Location Port 可选方法和类型化资源结果。[Core 注册表](../../packages/infrastructure/src/registry.ts)校验声明并公开目录/运行状态，[绑定](../../packages/infrastructure/src/binding.ts)按需激活兼容实现。[Filesystem 位置值](../../extensions/filesystem/src/location/values.ts)、[manifest](../../extensions/filesystem/src/manifest.ts)和[行为](../../extensions/filesystem/src/location/behavior.ts)区分定义、声明与代码。[LocationBehaviorService](../../packages/infrastructure/src/location.ts)按操作绑定，[准入](../../packages/game/src/admission.ts)用它检查录入及重复项。

通过所属包 provider 或发现 source 注册含 manifest 与惰性 loader 的 Contribution。Manifest 在 `contributes.locations` 声明稳定位置 ID、独立 Schema 版本/范围和 `dataSchema`，在 `contributes.adapters` 声明兼容 Adapter。边界的 `dataSchema` 接受 Standard Schema 或 JSON Schema，存储/传输为 JSON Schema，使用 arktype 求值并通过 `@ark/json-schema`/`toJsonSchema` 转换。进程内 Standard Schema 是显式可执行边界，其 Schema hook 可能运行；普通声明禁止 getter 不表示 Schema 转换是被动数据或已隔离。外部安装清单使用纯 JSON。激活调用 `context.registerAdapter(id, locationImplementation, implementation)`，core 在成功后统一发布暂存运行实例。定义不是配置实例，`checkLocation` 只检查注册类型/范围，不做实际数据校验；依赖问题保留为目录诊断和受阻激活。Provider 归属、子作用域及运行期管理见[服务/生命周期指南](006-SERVICES-AND-EXTENSION-LIFECYCLE.md)。

按需携带 Host 上下文调用 `LocationBehaviorService.validate`、`.compare`、`.resolve`。每次操作在获取类型化运行实例前绑定 Contract、Operation、Capability 与 Schema 支持。比较同时绑定两侧，`unknown`/`incomparable` 不能当作 `different`；解析可以返回非路径资源。不要通过路径字符串或 JSON 序列化去重。运行绑定是注册表签发的对象，保存的计划不能重放为执行句柄。

| 版本 | 当前含义 |
| --- | --- |
| `workspace.experimental.4` | Workspace 记录封装；不读取或迁移旧 Schema 3。 |
| 位置 Schema `1.0.0` | 文件系统位置数据形状；filesystem 当前声明精确范围 `1.0.0`。 |
| Contract `0.2.0` | Port 协议，单独协商兼容性。 |
| Core `0.1.0-alpha.0` | 核心包统一发行版本，含 `@konogame/workspace-configuration`。 |
| Extension `0.1.0-alpha.0` | filesystem/Steam 当前独立发行版本。 |

[核心配置 Adapter](../../packages/workspace-configuration/src/index.ts)属于 `konogame.workspace` Module，文件系统位置行为属于 Extension。读取配置不依赖 Location 注册。已有 Node 读取/重命名 transport 保留，[录入 I/O](../../packages/workspace-configuration/src/workspace-import.ts)可注入；尚无通用 transport 抽象、marketplace/下载、独立 host 隔离；现已提供显式根 Node 安装发现，内置/注入 source 支持 [ADR 0006](adr/0006-SERVICE-OWNERSHIP-AND-LAZY-ACTIVATION.md)描述的惰性激活。

目录变化现会重算迟到 Location 定义及不同完整绑定请求。重放记录不比较资源，Location 相等仍通过同时支持两侧的 compare Port。严格声明校验和内部提交使公开通知前 Extension/Adapter 快照一致。已安装 Location Extension 可通过纯数据包声明，目录检查不导入它们。参见 [ADR 0007](adr/0007-EXTENSION-DISCOVERY-AND-LOAD-ROBUSTNESS.md)及[对照报告](007-EXTENSION-SYSTEM-COMPARISON.md)。

[English](../en/005-LOCATION-AND-REGISTRIES.md) | [中文](005-LOCATION-AND-REGISTRIES.md)
