---
name: agy-icon-studio
description: >-
  Audit installed Google Antigravity plugin icons, design unified-style 256x256
  PNG icons (including the canonical "AI Girls Universe" persona library and
  multiple art-style presets), back up originals to the local icon vault, and
  restore customized icons in one command after upstream plugin updates. Use
  whenever the user asks to scan missing/ugly plugin icons, generate or replace
  plugin icons, match a visual style across plugins, or restore overwritten
  custom icons.
---

# AGY Icon Studio · 插件图标工坊技能指南

本技能将“全盘插件图标体检 → 统一画风生图与审图 → 跨平台 256×256 规范化写入 → 保险箱备份与更新后一键还原”固化为标准作业流程（SOP）。

> [!IMPORTANT]
> - **先定位工具脚本**：本技能目录下的 `../../bin/icon-studio.mjs` 即插件根目录的 `bin/icon-studio.mjs`（若在全局插件目录运行，默认位于 `~/.gemini/config/plugins/agy-icon-studio/bin/icon-studio.mjs`）。
> - **绝对不要捏造画风锚点**：选用「AI 娘宇宙」风格时，必须先读取 `references/ai-girls-universe.md` 获取精确外貌描述与配色细节；选用其他非人物画风时，先读取 `references/icon-styles.md`。
> - **严格先审图再落盘**：每张由 `image-generator` 生成的原图都必须用 `read_file` 亲眼查看确认无文字/水印、无畸变且锚点吻合后，才允许调用 `apply`。

---

## 标准作业流程（6 步闭环）

### 第 1 步：全盘体检（`scan`）
在终端执行只读体检命令：

```bash
node "<PLUGIN_ROOT>/bin/icon-studio.mjs" scan --json
```

向用户简明汇报结果，重点列出：
- `logoType === "missing"`（完全缺少图标）与 `logoType === "broken"`（路径失效）；
- `logoType === "local-svg"`（纯几何矢量图标，通常简陋、可推荐升级精绘 PNG）；
- `drifted === true`（曾在保险箱托管，但被插件更新覆盖了）。

### 第 2 步：确定目标插件与统一画风
若目标不明确或画风未定，使用 `ask_question` 一次性对齐两个选择：
1. 要处理/升级哪些插件；
2. 采用哪套画风预设（默认推荐 **「AI 娘宇宙 / Q 版猫娘」**，对应 `references/ai-girls-universe.md`；备选 3D 潮玩、毛玻璃极简、像素风见 `references/icon-styles.md`）。

按选择读取对应的参考文件。

### 第 3 步：并行批量生成 1:1 高清原图
对多个插件需要生图时，**在同一回合并行调用多个 `invoke_subagent`（`TypeName: "image-generator"`）**：
- 必须传入 `references/*.md` 中的精确角色视觉锚点 + 该插件专属主题道具；
- 明确要求 **1:1 正方形构图**、主体占画面 80%–85%（保证缩小到 48×48 像素列表图标依然清晰）；
- 明确禁用任何文字、字母、数字、水印和 UI 边框。

### 第 4 步：逐张亲眼审图（`read_file`）
收到生成路径后，并行调用 `read_file` 查看每张图片：
- 检查角色发色/发饰/瞳色/耳角是否完全还原；
- 检查是否有意外文字、多余肢体或模糊裁剪；
- 若某张未达标，仅针对该张修正提示词重画一次。

### 第 5 步：自动缩放 256×256 PNG、写入插件并归档保险箱（`apply`）
审图通过后，对每个目标插件执行 `apply`（自动跨平台缩放为 256×256 PNG、备份原始配置到 `~/.gemini/icon-vault/<dir>/original/`、保存自定义图标到 `custom/logo.png`、写入目标插件 `assets/logo.png` 并更新 `plugin.json`）：

```bash
node "<PLUGIN_ROOT>/bin/icon-studio.mjs" apply --dir "<plugin-dir>" --src "<generated-image-path>" --style "<style-tag>" --json
```

若目标插件此前已经手工更换过漂亮图标、只需纳入保险箱托管防覆盖，可执行：

```bash
node "<PLUGIN_ROOT>/bin/icon-studio.mjs" vault import-current --dir "<plugin-dir>" --style "<style-tag>" --json
```

### 第 6 步：刷新缓存并交付
图标写入与 `plugin.json` 更新后，Antigravity Language Server 后端会自动读取最新清单，但桌面客户端前端存在快照缓存，请提示用户：
- **原生「自定义扩展（Customizations）」页面**：在 Antigravity 窗口按 `Ctrl+R`（macOS 为 `Cmd+R`）重载窗口，或重启一次客户端，新图标即刻同步；
- **AGY Market 面板**：点击面板右上角刷新按钮即可查看最新本地图标；
- 提醒受上游市场更新覆盖的外部插件可通过保险箱随时恢复，而纯本地/自研插件图标将长期保留。

---

## 灾后一键恢复与无损回滚

- **某次上游更新把定制图标冲掉了？**
  先 `scan --json` 确认 `drifted: true` 的插件，然后一行命令批量全部恢复：
  ```bash
  node "<PLUGIN_ROOT>/bin/icon-studio.mjs" restore --all --json
  ```
- **想把某个插件恢复回更换前的原始出厂状态？**
  ```bash
  node "<PLUGIN_ROOT>/bin/icon-studio.mjs" revert --dir "<plugin-dir>" --json
  ```
- **查看当前图标保险箱清单：**
  ```bash
  node "<PLUGIN_ROOT>/bin/icon-studio.mjs" vault list --json
  ```
