# ADR 0004：本地发现、审核录入与显式注入

> 继任说明：[ADR 0011](0011-EFFECT-CONTRACTS-AND-LIFETIME.md) 以 Effect 4.0.6 替代本文的依赖注入、异步 Port、观察、组装与生命周期细节。本文保留原日期的决策记录，其余领域与归属约束继续适用。

状态：已采纳，2026-10-17。

## 背景

本地实验需要从 Steam 与散装目录发现候选，经审核后录入现有 Workspace。目录是证据，不足以证明游戏身份。预览 JSON 可被修改，Game 与 Installation 创建涉及多个文件，测试还需要摆脱真实游戏 I/O。

## 决策

新增 core `@konogame/game`，使用共享 core 版本 `0.1.0-alpha.0`。`game.discover` 解析 `game.discovery/discover`，要求 `discovery.local`、`discovery.scoped` 及配置来源 Capability。filesystem 提供 `filesystem.game-discovery`；独立版本 `konogame.steam@0.1.0-alpha.0` 提供 `steam.game-discovery`。Steam 软件兼容标记为 `generic`，通过合成夹具验证，不承诺覆盖所有 Steam 版本。

必须已有 Host 及 `configured` 的 `steam` 或 `standalone` 来源。调用者显式选择范围；Host roots、来源声明和 Steam 库引用都不扩大范围。本轮不联网补全、不探测可执行入口、不启动、不创建来源、不修改游戏文件。目录候选只有弱身份；新增安装的 `launchEntries` 为空。

应用预览读取配置和发现 Port，返回候选、证据、诊断、处置、修订与绑定。确认严格解析预览，独立锚定 root，检查摘要，重读修订并按原绑定重新发现所选范围，比较重建计划；记录由应用重新构造和校验，不信任提交的记录。摘要用于变更检测，不是认证签名；没有 TTL。可靠 Steam App ID 可复用 Game，标题相似不能合并。同 Host 上相等 Location 来自其他 source 时报告冲突。新预览可对重复录入返回 unchanged；成功消费后的旧预览重放会过期。

新增 `workspace.configuration/import` 与 `configuration.import`，以及 `recover-import` 与 `configuration.import-recovery`。核心配置实现共享重命名写锁，校验哈希、保留已有记录原始字节/布局，用 journal 前向恢复未完成创建。新文件先在目标同目录暂存并 fsync，再通过不替换目标的独占硬链接发布。Workspace 所在文件系统须支持硬链接；不支持时发布失败，不降级覆盖。跨文件联合创建不是原子的；外部改动使恢复明确停止。恢复仅处理现有操作 journal/receipt，不建立通用事务引擎、不回滚录入、不自动重试旧预览。

服务组装精确使用 `injection-js` 2.6.1，显式 InjectionToken provider 对象及 `inject`/`injector.get`，禁用依赖注入装饰器、`reflect-metadata`、隐式 class provider 和反射 metadata 生成。DI 组装实现，Binding Plan 独立确认领域能力兼容。有状态服务与复杂 Adapter 采用类封装，小型纯函数与组装工厂仍适用。从首个切片设计可替换 I/O、clock、ID、配置 Port 与发现 Adapter。实体身份和值语义用于指导后续领域行为，实体以稳定 ID 区分，值对象按值比较。

## 影响与限制

基础本地发现/录入不依赖 Daemon 或历史。用户审核选择候选并显式确认写入。扫描器或确认操作都不会自动认证某个散装目录一定是游戏。通用编辑、流式进度、持久扫描任务、更多商店、存档定位、元数据/AI 补全和启动仍属未来工作。参见[实验指南](../002-WORKSPACE-EXPERIMENT.md)、[开发指南](../004-DEVELOPMENT.md)及[发现路线图](../roadmap/003-GAME-DISCOVERY.md)。

## 参考

- [Valve KeyValues 实现](https://raw.githubusercontent.com/ValveSoftware/source-sdk-2013/master/src/tier1/KeyValues.cpp)，核对于 2026-10-17。Adapter 只实现有界数据子集；本地清单字段是实验格式观察，不是 Valve 稳定 API 承诺。
- [injection-js 官方仓库](https://github.com/mgechev/injection-js)，核对于 2026-10-17。仓库策略选用显式 provider 和 2.6.1 版本。

位置与归属补充：[ADR 0005](0005-LOCATION-REGISTRIES-AND-CORE-PERSISTENCE.md)要求候选/安装比较使用绑定的位置校验和比较，并同时支持两侧。未知/不可比较保持显式，新录入不能将其当作不同。核心 `@konogame/workspace-configuration` 拥有录入/journal 恢复，Adapter 属于 Module。Pending 恢复只恢复已批准元数据，不执行位置，也不增加位置注册门槛。

[English](../../en/adr/0004-LOCAL-DISCOVERY-AND-INJECTION.md) | [中文](0004-LOCAL-DISCOVERY-AND-INJECTION.md)
