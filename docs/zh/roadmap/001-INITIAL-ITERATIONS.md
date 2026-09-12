# 初始迭代计划

当前支持的流程见[架构概览](../001-ARCHITECTURE.md)和[Workspace 管理指南](../008-WORKSPACE-MANAGEMENT.md)。以下顺序按各项工作需要先验证的依赖排列。

| 后续工作 | 启动条件与验收目标 |
| --- | --- |
| 本地存档备份与恢复 | 选择一种有合成样本的存档。验证发现、导出、多文件流式存储和显式导入，预览将影响的文件，并报告部分失败。 |
| [更多游戏发现来源](003-GAME-DISCOVERY.md) | 取得来源格式夹具后验证受限扫描、跨来源身份冲突和部分结果。 |
| [管理前端](004-FRONTEND-EXPERIENCE.md) | 先选本地宿主，用真实应用服务完成候选审核。游玩操作等待启动语义确定。 |
| [可选配置历史](002-WORKSPACE-CONFIGURATION.md) | 在临时 Git 仓库验证记录和恢复，覆盖用户已有暂存内容的情形。 |

后续按具体用例评估 Ludusavi 的存档知识、Kopia 快照及 OpenDAL 存储。Patch 和 Notes 需要先定义 Feature 与 Artifact；Trilium、Syncthing、Rclone、RustFS 的接入取决于笔记或传输需求。持久任务、远程访问、扩展隔离和桌面打包各自需要宿主、权限与恢复方面的决策。

[English](../../en/roadmap/001-INITIAL-ITERATIONS.md) | [中文](001-INITIAL-ITERATIONS.md)
