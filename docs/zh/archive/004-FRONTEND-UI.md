# 04 前端：10 英尺 UI 与交互

> 历史草案。UI 范围尚未确定，参见[当前路线图](../roadmap/001-INITIAL-ITERATIONS.md)。

前端必须完全可通过 Xbox/PS 手柄导航，针对大屏电视优化（10-foot UI）。

## 1. 技术栈要求

- **框架**：React 18+（严格 CSR，无 SSR）。
- **数据获取**：`@tanstack/react-query` 用于 API 轮询和缓存。
- **路由**：`@tanstack/react-router` 用于类型安全的路由。
- **样式**：TailwindCSS + `shadcn/ui`（为暗色/赛博朋克主题定制）。

## 2. 空间导航与手柄

- **不要依赖原生 DOM `tabIndex`**。
- 使用 `@noriginmedia/norigin-spatial-navigation` 包装组件。
- 使用 `react-use` → `useGamepad` 监听原生控制器输入（A/B/X/Y，方向键）。将 A 映射到 `onClick`，B 映射到 `history.back()`。

## 3. Framer Motion 与共享布局（对 UX 至关重要）

- 避免生硬的页面切换。
- 使用 Framer Motion 的 `layoutId` 属性。
- 示例：网格中的 `<img layoutId={"poster-" + game.id} />` 必须在被选中时平滑过渡到详情页的英雄横幅。
- 物理效果：使用弹簧动画（`type: "spring", stiffness: 300, damping: 30`）模拟主机 UI 惯性。

## 4. 非阻塞任务 UI

- 长时间运行的任务（解压、S3 同步）不得阻塞主 UI。
- 在侧边显示一个可交互的 `Task Drawer`。
- 完成时，触发一个包含可操作按钮的 `shadcn/ui` Toast（例如：`[启动游戏]`、`[查看日志]`）。

[English](../../en/archive/004-FRONTEND-UI.md) | [中文](004-FRONTEND-UI.md)
