# ADR 0001：Feature、Capability 与绑定术语

状态：作为初始骨架的已采纳决策（2026-10-17）。

## 背景

无论 Adapter 提供历史版本还是仅复制文件，`save.store` 都应是用户可见的任务。把版本化叫作 sub-feature，会混淆可选的 Adapter 性质与独立请求的流程。

## 决策

**Feature** 表示用户意图，**Operation** 表示 Port 方法，**Capability** 表示 Adapter 性质。因此 `save.store` 是 Feature，`put` 是 Operation，`history.versioned` 是 Capability。`save.history` 是独立 Feature，因为列出或恢复历史版本是单独请求的流程；没有匹配 Adapter 时它不可用。

一个 Extension 可以发布多个 Adapter 描述。应用按 Port、兼容 Contract 范围、Operation 和必需 Capability，为请求的 Feature 生成 Binding Plan。兼容候选按优先级选择，同分时按稳定 ID 排序。用户明确偏好会限制候选，失败写入 `unavailable`，不会隐式回退。先解析再执行。Plan 记录选中的 Adapter 与 Extension ID，方便检查。

CLI 和 Daemon 共享应用服务，只在传输与进程生命周期上不同。Contract 协议版本与软件包发行版本分开。Core 包统一发行版本，Extension 独立版本，描述符用 SemVer 范围声明 Contract 兼容性，见 [ADR 0003](0003-RELEASE-VERSIONS-AND-COMPATIBILITY.md)。动态加载暂缓。

## 影响

基础 filesystem 存储无需历史版本。未来 Kopia Adapter 可以增加 `history.versioned`，不改变 `save.store` 的含义。OpenDAL、Kopia 等 Extension 可实现多个 Module 的 Port。跨模块载荷保持多文件流式 Artifact 契约。

[English](../../en/adr/0001-CAPABILITY-BINDING.md) | [中文](0001-CAPABILITY-BINDING.md)
