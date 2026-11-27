# Changelog

## [0.1.0] - 2026-11-27

### Added
- 初始开源版本发布：**AGY Icon Studio · 插件图标工坊**（MIT License）。
- 零第三方依赖跨平台 Node CLI（`bin/icon-studio.mjs`）：
  - `scan`：全盘插件图标体检（识别 `missing`、`local-svg`、`local-raster`、`remote-https`、`broken` 及 `drifted` 漂移状态）。
  - `apply`：跨平台高质量缩放为 256×256 PNG（Windows `System.Drawing` / macOS `sips` / Linux `magick`·`PIL`·`ffmpeg` 自动适配）、自动备份原始图标并归档保险箱、更新 `plugin.json`。
  - `restore`：上游插件更新覆盖后，一键将保险箱中保存的自定义图标写回所有已安装插件。
  - `revert`：无损回滚单个插件的原始 `logo` 字段与原本地图标文件。
  - `vault list` / `vault import-current`：管理 `~/.gemini/icon-vault/` 图标保险箱，支持收编现有自定义图标。
- 内置 `SKILL.md` 及两套参考库：
  - `references/ai-girls-universe.md`（致敬 B 站 `@ZipZipPipe`《大AI和小AI们》AI 娘宇宙公认设定与各类插件道具模板）。
  - `references/icon-styles.md`（3D 潮玩盲盒、Glassmorphism 毛玻璃徽章、复古 16-bit 像素风预设）。
- 补充沙箱单元测试 `tests/icon-studio.test.mjs` 与一键本地部署脚本 `scripts/install-local.ps1`。
