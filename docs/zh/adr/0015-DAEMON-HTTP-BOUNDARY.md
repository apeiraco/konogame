# ADR 0015 · Daemon HTTP 边界

> 展示归属更新：由 WebUI 提供离线参考页，daemon 保留 JSON 规范。见 [WebUI 指南](../010-WEBUI.md)。

2026-11-03 采纳。

## 决策

采用 Hono 及其 Node 适配器公开现有应用服务。CLI 与 daemon 组装相同的领域 Layer。资源归属、取消及恢复继续由 Effect 工作流处理。HTTP 路由将请求转换为服务输入，通过 OpenAPI 描述结果。本地服务同时提供 HTML 参考页和 JSON 规范。

## 选型依据

Hono 和 Elysia 都支持 Node 与 TypeScript。Elysia 提供集成校验和 OpenAPI 插件，适合从 HTTP Schema 开始设计的服务。本仓库已用 ArkType 定义公开记录和编辑意图，依赖注入和请求生命周期由 Effect 4.0.6 负责。选择 Hono 的 Fetch 接口和 Node 适配器，可以在 HTTP 边界复用这些决定。本次没有以吞吐量作为选型依据。[Hono Node.js](https://hono.dev/docs/getting-started/nodejs) · [Hono validation](https://hono.dev/docs/guides/validation) · [Elysia Node.js](https://elysiajs.com/integrations/node) · [Elysia OpenAPI](https://elysiajs.com/plugins/openapi)

锁定版本的 Effect 本身也提供 `effect/http-api`。对于以 Effect Schema 定义传输协议的应用，其 endpoint 模型很自然；在此采用则需要另行确定它与现有 ArkType 契约的对应关系。

## 范围

Daemon 服务面向使用本机文件系统权限的本地客户端。请求中的 Workspace 根和存档源目录均指 daemon 所在主机。操作在请求内完成。远程账号、持久任务和无人值守恢复需要独立设计。

[English](../../en/adr/0015-DAEMON-HTTP-BOUNDARY.md) | [中文](0015-DAEMON-HTTP-BOUNDARY.md)
