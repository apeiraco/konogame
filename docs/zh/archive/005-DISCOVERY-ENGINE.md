# 05 渐进式漏斗发现

> 历史草案。当前存档发现只有 Port 定义，参见[当前架构](../001-ARCHITECTURE.md)。

发现机制严格采用选择性加入（OPT-IN）。未经用户明确同意，不执行自动后台扫描，以尊重隐私并避免 I/O 瓶颈。

## 四级漏斗架构

### Level 1：本地启发式扫描（Rust）

- 快速扫描。寻找引擎特征指纹。
- 目标：`data.xp3`（Kirikiri）、`www/`（RPG Maker MV/MZ）、`steam_api.dll`（Steam）。

### Level 2：定向探测（Rust）

- 根据 Level 1 发现的引擎探测可预测的存档路径。
- 检查 `$USERPROFILE/Documents`、`$APPDATA/LocalLow`。
- 检查 Windows 注册表（`HKCU\Software\`）中的 Unity `PlayerPrefs`。

### Level 3：网络元数据（Node.js 插件）

- 如果发现 AppID 或明确的文件夹名称，则派发给 Node 插件。
- 抓取 SteamDB、PCGamingWiki 或 VNDB API 以获取高清封面、正确标题和标准云存档路径。

### Level 4：AI 启发式兜底（Python 插件）

- 针对无标准结构的冷门同人游戏。
- Python 插件读取游戏文件夹中的 `readme.txt` 或 `お読みください.txt`。
- 将内容发送给本地 LLM，使用以下提示词结构：
  > "You are a game directory analyzer. Read the following Japanese manual. Extract the 'Translated Chinese Title' and the 'Exact Save File Path' (relative to game root or absolute). Return strictly as JSON: {\"title\": \"...\", \"save_path\": \"...\"}"
- Rust 解析此 JSON 并自动生成 `konogame.toml` 清单。

[English](../../en/archive/005-DISCOVERY-ENGINE.md) | [中文](005-DISCOVERY-ENGINE.md)
