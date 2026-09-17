# WebUI 游戏库与发现审核

WebUI 是本机 Workspace 的浏览器客户端。Vite 与 TanStack Start 构建静态 SPA；React 和 Mantine 提供界面，TanStack Router 管理导航，TanStack Query 管理 daemon 的查询及录入后的刷新。当前构建可从深链接进入页面；未来开启路由级 SSR 或 SSG 时还需要验证宿主与数据加载边界。

## 从发现到游戏库

1. 在欢迎页输入已有 Workspace 的绝对根目录，之后可通过顶栏的工作区控件切换。路径由 daemon 所在主机解释。**浏览工作区…** 会打开 daemon 一侧位置的树：展开文件夹只列出其直接子项，选中后只检查该文件夹是否有工作区标记。当前聚焦的层级及其上一级、下一级逐级缩进；更早的祖先与上一级同列并以虚线标示，层级较深时也不会过度右移。手填和浏览所选路径都在正式读取 Workspace 成功后才切换会话；失败时就地说明，并保留当前工作区。
2. 进入发现页，选中已经配置的 Host 和来源，填写本次允许扫描的目录并生成预览。
3. 查看新游戏、加入已有游戏、已记录和冲突的分类统计。选择栏和确认对话框都按结果统计所选候选；共享同一游戏身份的候选会合并为一个游戏，等价位置只写入一次，因此实际写入的记录数以结果为准。确认时需要明确勾选。提交陈旧或失败时关闭旧审核，并提供用相同范围重新预览；只有需要恢复的结果才提供恢复操作。
4. 返回游戏库。可在封面与列表密度间切换，按状态、主机或来源筛选，用 Enter 打开详情。按主机或来源筛选时，卡片显示筛选范围内安装的状态。按 Esc 或返回链接后，焦点回到同一款游戏。封面为生成图并带有明确标记，目前没有真实封面来源。

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

## 视觉语言

第 11 轮以“档案书架”语言取代原型外观：暖色纸面或墨色表面、本机系统字体中的衬线标题，以及唯一的朱红强调色。明暗配色跟随操作系统。安装状态和发现结果同时使用文字与标记形状，含义不只依赖颜色。全站使用同一种粗焦点轮廓；选中使用蓝色边条与底色，悬停只做抬升或着色。用户偏好减少动态效果时，装饰性动画停止。宽度小于 760 px 时导航停靠在底部，候选行变为纵向卡片。

主题变量见[主题](../../apps/webui/src/infrastructure/theme/theme.ts)与[样式表](../../apps/webui/src/styles.css)。手柄输入尚未在真实设备上验证；已验证键盘移动、确认与返回。

[English](../en/010-WEBUI.md) | [中文](010-WEBUI.md)
