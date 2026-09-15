# WebUI 游戏库与发现审核

WebUI 是本机 Workspace 的浏览器客户端。Vite 与 TanStack Start 构建静态 SPA；React 和 Mantine 提供界面，TanStack Router 管理导航，TanStack Query 管理 daemon 的查询及录入后的刷新。当前构建可从深链接进入页面；未来开启路由级 SSR 或 SSG 时还需要验证宿主与数据加载边界。

## 从发现到游戏库

1. 打开游戏库，选择已有 Workspace 的绝对根目录。路径由 daemon 所在主机解释。
2. 进入发现页，选中已经配置的 Host 和来源，填写本次允许扫描的目录并生成预览。
3. 核对候选、来源证据和冲突，勾选需要的记录后明确确认录入。预览失效时重新扫描并审核。
4. 返回游戏库查看已录入的游戏，打开详情检查安装实例。封面使用本地占位。使用键盘从卡片进入详情，返回后继续操作同一款游戏。

## 状态与生命周期

每个 Router 实例拥有独立的 WebUI 应用上下文。组合入口通过 Effect Layer 提供 Workspace 会话、游戏库、发现审核及其 HTTP 与存储依赖。替换 Layer 即可在不挂载 React 的情况下执行服务测试。TanStack Start 的客户端启动与水合边界负责接入浏览器资源。

| 状态或行为 | 归属 |
| --- | --- |
| 当前 Workspace、库筛选和待恢复焦点的 Game ID | 服务持有共享状态，通过 Preact signals 发布。绑定 DOM 节点、滚动和实际聚焦由视图完成。 |
| 候选选择、审核确认、提交、冲突和恢复 | 审核服务用 Effect 执行命令，检查请求是否仍属于当前 Workspace 和本次审核。daemon 最终校验修订和写入。 |
| 库列表、详情和配置检查的远端结果 | TanStack Query 管读缓存及失效。按当前 Workspace 根路径区分缓存。 |
| 当前地址、详情参数与组件树 | TanStack Router 管导航，React/Mantine 渲染。路由树由 TanStack 生成，Biome 强制忽略，TypeScript 继续检查其使用方。 |

入口在[浏览器组合](../../apps/webui/src/app/webui-app-context.ts)。[审核服务](../../apps/webui/src/game/discovery/discovery-review.service.ts)校验选择与确认，Workspace 切换时中断旧请求；即使重新打开同一路径，旧响应也不能改写新审核。组件卸载本身不会丢弃当前会话的选择。[库服务](../../apps/webui/src/game/library/library.service.ts)按根路径保存筛选及返回焦点目标。

## 开发约定

按用户操作组织代码。游戏墙与详情归 `game/library/`，候选审核归 `game/discovery/`，会话与记录查询归 `workspace/`，Scalar 页面独立放在 `developer/openapi/`。在功能目录中相邻放置视图、服务、读模型和测试；只将真正复用的 HTTP、Effect 边界及展示组件放入 `infrastructure/`。`routes/` 保持为路由入口。

筛选、选择、确认勾选和焦点目标等内存状态同步更新；多字段需对外同时可见时使用 signals 的批处理。网络、持久化以及需要取消或协调的异步工作流由 Effect 管理。视图渲染时读取只读信号的 `.value`。构建插件用 Oxc 识别组件和 Hook，用 esrap 生成订阅代码，并用 MagicString 保留原始 TSX 与源码映射。用 `.peek()` 表达刻意的非订阅读取，例如一次性的 DOM 焦点恢复。

用完自己创建的 WebUI 应用上下文时，异步调用方使用 `await using` 交还所有权。Router 生命周期回调通过标准 `Symbol.asyncDispose` 释放上下文，Effect Scope 继续负责其 Layer 资源。[客户端入口](../../apps/webui/src/client.tsx)集中检查两种释放符号、两种资源栈及 SuppressedError；缺失时按需补齐，再启动应用。首屏输入等待水合与本地路径恢复完成。转换规则和源码映射见 [Signals 转换器](../../apps/webui/tools/signals-transform.ts)。

开发时修改受转换的组件或 Hook，Vite 会重新加载页面：当前 Oxc Fast Refresh 不会为订阅清理用的 `try/finally` 内的 Hook 生成完整签名。这只影响编辑源码时的热更新；正常的信号写入仍只更新已订阅的视图。

## 界面语言与时间 API

首次使用简体中文。在应用外壳选择 English 或简体中文可即时切换；同一浏览器下次打开仍使用上次选择。切换语言时，当前 Workspace、游戏 ID、审核预览和勾选项保留，操作无需重新扫描。偏好存放在浏览器本地存储，与 Workspace 文件分开。预渲染与首次水合使用相同的默认语言，随后恢复偏好并更新 HTML 的语言属性。

每个 WebUI 应用上下文创建独立的 i18next 实例。功能自有词条随应用打包，在视图中使用稳定的语义键和插值。测试检查中英文词条、参数与各自需要的复数形式。给新操作添加词条时，同时检查按钮、辅助技术名称和错误摘要。保留游戏名、文件路径、协议 ID 以及 daemon 的原始诊断。Scalar 页同步产品外壳及查看器的语言设置；OpenAPI 契约、示例值和第三方诊断仍按原文展示。

浏览器启动时检测 Temporal；缺失时动态加载随应用分发的 `@js-temporal/polyfill`。原生 Temporal 可用时直接使用，Intl 始终使用平台实现。

## 开发者参考

访问 `/developer/openapi` 加载 Scalar。页面从同源的 `/api/openapi.json` 读取实时规范。业务请求和文档调试请求都发送给本机 daemon。启动、离线访问和测试命令见下文。

## 运行与验证

执行 `just build` 和 `just daemon`，浏览器打开 `http://127.0.0.1:38417/`。开发时保持 daemon 运行，另开终端执行 `just webui-dev` 并访问 `http://127.0.0.1:5173/`。Vite 校验本地请求并转发同源 `/api`，包括 JSON POST。直接打开 `/developer/openapi` 可以查阅 API 并试发请求。

浏览器端到端测试使用 Playwright 驱动 Chromium。可使用本机 Chrome，或用 `pnpm exec playwright-core install chromium` 安装测试浏览器。自定义可执行文件用 `KONOGAME_TEST_CHROMIUM` 指定。`just check` 会构建前端并运行这条真实浏览器流程。

第 10 轮页面是基本可用的临时原型。第 11 轮可以重新确定信息布局、设计语言、主题、卡片、交互控件和视觉表现；需要承接的是显式审核、同源访问、导航和焦点行为。

[English](../en/010-WEBUI.md) | [中文](010-WEBUI.md)
