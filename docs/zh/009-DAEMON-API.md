# 本机 daemon API

在仓库根目录执行 `just build`，再运行 `just daemon`。默认监听地址为 `127.0.0.1:38417`。用 `KONOGAME_DAEMON_PORT` 指定端口，`KONOGAME_SAVE_ROOT` 指定存档写入位置。Workspace 根与存档源目录均使用 daemon 主机上的绝对路径。POST 请求使用 `Content-Type: application/json`，请求体上限为 1 MiB。发现预览超过此限制时需缩小扫描范围后重新预览，再提交录入。

浏览器打开 `http://127.0.0.1:38417/api/openapi` 可离线查看每个操作的字段并发送请求。客户端和代码生成工具读取同一服务的 `GET /api/openapi.json`。字段、请求体、响应结构及具体路径以该规范为准。

## 从读取开始

以下 PowerShell 示例查询已登记的 Feature，并查看 Workspace 检查会选中哪个 Adapter。

~~~powershell
$base = "http://127.0.0.1:38417"
Invoke-RestMethod "$base/api/features"
Invoke-RestMethod "$base/api/plan" -Method Post -ContentType "application/json" -Body '{"features":["workspace.inspect"]}'
~~~

## 按工作流调用

- **Workspace**。初始化需要一个已存在的根目录。编辑先生成预览，把完整预览连同独立指定的根和确认字段交回 apply。冲突后重新读取并审核；如返回需要恢复，保留 operationId，调用对应的定向恢复操作。
- **游戏**。读取游戏库及详情可使用 GET。发现预览需要已有 Host、已配置来源及显式扫描范围。录入时提交审核过的预览、选中的候选和确认。扫描本身不会录入游戏。
- **存档**。向 `POST /api/saves` 提交本机目录。daemon 流式读取其中的文件，返回存储的 Artifact 引用。JSON 请求只携带目录信息，资产字节留在存储工作流内。
- **扩展**。可以列举贡献、检查来源与 Adapter 的状态、刷新显式配置的发现来源。刷新结果会区分增加、替换、删除及需要重启的贡献。

本机接口使用 daemon 进程的文件访问权限。写入和恢复应由受信任的本地客户端发起。选型与进程边界见 [ADR 0015](adr/0015-DAEMON-HTTP-BOUNDARY.md)。

[English](../en/009-DAEMON-API.md) | [中文](009-DAEMON-API.md)
