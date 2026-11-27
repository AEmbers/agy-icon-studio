#!/usr/bin/env node
/**
 * AGY Icon Studio · 插件图标工坊核心 CLI 与库模块
 * 零第三方依赖，提供全盘体检 (scan)、跨平台缩放应用 (apply)、
 * 更新覆盖一键还原 (restore)、无损回滚 (revert) 与保险箱管理 (vault)。
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RASTER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico']);

/**
 * 解析默认插件目录与图标保险箱目录，可通过参数或环境变量覆盖。
 * @param {object} [opts]
 * @returns {{ configDir: string, pluginsDir: string, vaultDir: string }}
 */
export function resolveDefaultPaths(opts = {}) {
  const homeDir = os.homedir();
  const configDir = process.env.ANTIGRAVITY_CONFIG_DIR
    ? path.resolve(process.env.ANTIGRAVITY_CONFIG_DIR)
    : path.join(homeDir, '.gemini', 'config');
  const pluginsDir = opts.pluginsDir ? path.resolve(opts.pluginsDir) : path.join(configDir, 'plugins');
  const vaultDir = opts.vaultDir ? path.resolve(opts.vaultDir) : path.join(homeDir, '.gemini', 'icon-vault');
  return { configDir, pluginsDir, vaultDir };
}

/**
 * 严格校验插件目录名，防止路径穿越与非法分隔符。
 * @param {string} dirName
 * @returns {string}
 */
export function validatePluginDirName(dirName) {
  const clean = String(dirName || '').trim();
  if (
    !clean ||
    clean === '.' ||
    clean === '..' ||
    clean.includes('/') ||
    clean.includes('\\') ||
    clean.includes('..') ||
    /[\x00-\x1f]/.test(clean)
  ) {
    throw new Error(`非法的插件目录名: "${dirName}"`);
  }
  return clean;
}

/**
 * 计算指定文件内容的 SHA-256 十六进制摘要。
 * @param {string} filePath
 * @returns {string}
 */
export function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 安全解析 path.resolve(pluginRoot, relPath) 并限制在 pluginRoot 目录之内。
 * @param {string} pluginRoot
 * @param {string} relPath
 * @returns {string | null}
 */
function resolveWithinRoot(pluginRoot, relPath) {
  const root = path.resolve(pluginRoot);
  const candidate = path.resolve(root, relPath);
  const prefix = `${root}${path.sep}`;
  const inside =
    process.platform === 'win32'
      ? candidate.toLowerCase().startsWith(prefix.toLowerCase())
      : candidate.startsWith(prefix);
  return inside ? candidate : null;
}

/**
 * 读取并解析插件目录下的 plugin.json。
 * @param {string} pluginPath
 * @returns {{ manifestPath: string, manifest: object, eol: string }}
 */
function readManifest(pluginPath) {
  const manifestPath = path.join(pluginPath, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`未找到 plugin.json: ${manifestPath}`);
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const manifest = JSON.parse(raw);
  return { manifestPath, manifest, eol };
}

/**
 * 原子写回格式化的 plugin.json，保持原有换行风格。
 * @param {string} manifestPath
 * @param {object} manifest
 * @param {string} [eol]
 */
function writeManifest(manifestPath, manifest, eol = '\n') {
  const text = JSON.stringify(manifest, null, 2).replace(/\n/g, eol) + eol;
  const tmpPath = `${manifestPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, text, 'utf8');
  fs.renameSync(tmpPath, manifestPath);
}

/**
 * 检查外部命令是否在当前系统 PATH 中可用。
 * @param {string} cmd
 * @returns {boolean}
 */
function hasCommand(cmd) {
  try {
    const checker = process.platform === 'win32' ? 'where.exe' : 'which';
    execFileSync(checker, [cmd], { stdio: 'ignore', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 跨平台将源图片高质量缩放为正方形 PNG（默认 256×256）。
 * 通过环境变量向子进程传参，避免路径转义与命令注入问题。
 * @param {string} srcPath
 * @param {string} dstPath
 * @param {number} [size]
 * @returns {{ resized: boolean, method: string, bytes: number, sha256: string }}
 */
export function resizeImageToPng(srcPath, dstPath, size = 256) {
  const absSrc = path.resolve(srcPath);
  const absDst = path.resolve(dstPath);
  if (!fs.existsSync(absSrc) || !fs.statSync(absSrc).isFile()) {
    throw new Error(`源图片文件不存在: ${absSrc}`);
  }
  const targetSize = Number(size);
  if (!Number.isInteger(targetSize) || targetSize < 32 || targetSize > 2048) {
    throw new Error(`无效的目标图标尺寸: ${size}（支持 32~2048）`);
  }

  fs.mkdirSync(path.dirname(absDst), { recursive: true });
  let method = '';
  let resized = false;

  if (process.platform === 'win32') {
    const psScript = [
      'Add-Type -AssemblyName System.Drawing;',
      '$src = $env:AGY_ICON_SRC;',
      '$dst = $env:AGY_ICON_DST;',
      '$sz = [int]$env:AGY_ICON_SIZE;',
      '$img = [System.Drawing.Image]::FromFile($src);',
      '$bmp = New-Object System.Drawing.Bitmap($sz, $sz);',
      '$g = [System.Drawing.Graphics]::FromImage($bmp);',
      '$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;',
      '$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality;',
      '$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality;',
      '$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality;',
      '$g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $sz, $sz)));',
      '$bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png);',
      '$g.Dispose(); $bmp.Dispose(); $img.Dispose();',
    ].join(' ');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      env: {
        ...process.env,
        AGY_ICON_SRC: absSrc,
        AGY_ICON_DST: absDst,
        AGY_ICON_SIZE: String(targetSize),
      },
      stdio: 'pipe',
      timeout: 30000,
    });
    method = 'windows-system-drawing';
    resized = true;
  } else if (process.platform === 'darwin' && hasCommand('sips')) {
    execFileSync(
      'sips',
      ['-s', 'format', 'png', '-z', String(targetSize), String(targetSize), absSrc, '--out', absDst],
      { stdio: 'pipe', timeout: 30000 },
    );
    method = 'macos-sips';
    resized = true;
  } else if (hasCommand('magick')) {
    execFileSync(
      'magick',
      [absSrc, '-resize', `${targetSize}x${targetSize}!`, absDst],
      { stdio: 'pipe', timeout: 30000 },
    );
    method = 'imagemagick';
    resized = true;
  } else if (hasCommand('convert')) {
    execFileSync(
      'convert',
      [absSrc, '-resize', `${targetSize}x${targetSize}!`, absDst],
      { stdio: 'pipe', timeout: 30000 },
    );
    method = 'imagemagick-convert';
    resized = true;
  } else if (hasCommand('python3')) {
    const pyCode = [
      'import os, sys',
      'from PIL import Image',
      'im = Image.open(os.environ["AGY_ICON_SRC"]).convert("RGBA")',
      'sz = int(os.environ["AGY_ICON_SIZE"])',
      'im.resize((sz, sz), Image.Resampling.LANCZOS).save(os.environ["AGY_ICON_DST"], "PNG")',
    ].join('\n');
    try {
      execFileSync('python3', ['-c', pyCode], {
        env: {
          ...process.env,
          AGY_ICON_SRC: absSrc,
          AGY_ICON_DST: absDst,
          AGY_ICON_SIZE: String(targetSize),
        },
        stdio: 'pipe',
        timeout: 30000,
      });
      method = 'python3-pillow';
      resized = true;
    } catch {
      /* 若系统 python3 未安装 Pillow，继续探测 ffmpeg 或回退复制 */
    }
  }

  if (!resized && hasCommand('ffmpeg')) {
    execFileSync(
      'ffmpeg',
      ['-y', '-i', absSrc, '-vf', `scale=${targetSize}:${targetSize}:flags=lanczos`, absDst],
      { stdio: 'pipe', timeout: 30000 },
    );
    method = 'ffmpeg';
    resized = true;
  }

  if (!resized) {
    const ext = path.extname(absSrc).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      throw new Error('未找到可用的跨平台图片缩放器（magick/sips/ffmpeg/PIL），请先安装或提供 PNG 原图');
    }
    fs.copyFileSync(absSrc, absDst);
    method = 'copy-fallback';
    resized = false;
  }

  const stat = fs.statSync(absDst);
  return {
    resized,
    method,
    bytes: stat.size,
    sha256: sha256File(absDst),
  };
}

/**
 * 读取指定插件在保险箱中的 meta.json 信息（若存在）。
 * @param {string} vaultDir
 * @param {string} dir
 * @returns {object | null}
 */
function readVaultMeta(vaultDir, dir) {
  const metaPath = path.join(vaultDir, dir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 扫描全部已安装插件的图标健康状态及与保险箱的漂移状态。
 * @param {object} [opts]
 * @returns {{ pluginsDir: string, vaultDir: string, summary: object, plugins: object[] }}
 */
export function scanPlugins(opts = {}) {
  const { pluginsDir, vaultDir } = resolveDefaultPaths(opts);
  if (!fs.existsSync(pluginsDir)) {
    return {
      pluginsDir,
      vaultDir,
      summary: { total: 0, missing: 0, localSvg: 0, localRaster: 0, remoteHttps: 0, broken: 0, vaultBacked: 0, drifted: 0 },
      plugins: [],
    };
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const plugins = [];
  const summary = {
    total: 0,
    missing: 0,
    localSvg: 0,
    localRaster: 0,
    remoteHttps: 0,
    broken: 0,
    vaultBacked: 0,
    drifted: 0,
  };

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = ent.name;
    const pluginPath = path.join(pluginsDir, dir);
    const manifestPath = path.join(pluginPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest = {};
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }

    summary.total += 1;
    const rawLogo = typeof manifest.logo === 'string' ? manifest.logo.trim() : '';
    let logoType = 'missing';
    let logoBytes = 0;
    let logoSha256 = '';
    let resolvedLogoPath = '';

    if (!rawLogo) {
      logoType = 'missing';
      summary.missing += 1;
    } else if (/^https?:\/\//i.test(rawLogo)) {
      logoType = 'remote-https';
      summary.remoteHttps += 1;
    } else {
      const candidate = resolveWithinRoot(pluginPath, rawLogo);
      if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        logoType = 'broken';
        summary.broken += 1;
      } else {
        resolvedLogoPath = candidate;
        logoBytes = fs.statSync(candidate).size;
        logoSha256 = sha256File(candidate);
        const ext = path.extname(candidate).toLowerCase();
        if (ext === '.svg') {
          logoType = 'local-svg';
          summary.localSvg += 1;
        } else if (RASTER_EXTENSIONS.has(ext)) {
          logoType = 'local-raster';
          summary.localRaster += 1;
        } else {
          logoType = 'broken';
          summary.broken += 1;
        }
      }
    }

    const meta = readVaultMeta(vaultDir, dir);
    const customVaultFile = path.join(vaultDir, dir, 'custom', 'logo.png');
    const vaultBacked = Boolean(meta && fs.existsSync(customVaultFile));
    let drifted = false;
    if (vaultBacked) {
      summary.vaultBacked += 1;
      const expectedSha = meta.customSha256 || sha256File(customVaultFile);
      const expectedTarget = meta.targetLogo || 'assets/logo.png';
      const normalizedRaw = rawLogo.replace(/\\/g, '/').replace(/^\.\/+/, '');
      if (normalizedRaw !== expectedTarget || logoSha256 !== expectedSha) {
        drifted = true;
        summary.drifted += 1;
      }
    }

    plugins.push({
      dir,
      name: manifest.name || dir,
      displayName: manifest.displayName || manifest.name || dir,
      version: manifest.version || '',
      logo: rawLogo,
      logoType,
      logoBytes,
      logoSha256,
      resolvedLogoPath,
      vaultBacked,
      vaultStyle: meta?.style || '',
      drifted,
    });
  }

  return { pluginsDir, vaultDir, summary, plugins };
}

/**
 * 为指定插件更换自定义图标：缩放为 PNG、首次更换时备份原配置、更新 plugin.json 并归档至保险箱。
 * @param {object} opts
 */
export function applyIcon(opts = {}) {
  const { pluginsDir, vaultDir } = resolveDefaultPaths(opts);
  const dir = validatePluginDirName(opts.dir);
  const srcPath = path.resolve(String(opts.src || ''));
  const size = opts.size ? Number(opts.size) : 256;
  const style = String(opts.style || 'custom').trim() || 'custom';
  const keepRaw = Boolean(opts.keepRaw);

  const pluginPath = path.join(pluginsDir, dir);
  const { manifestPath, manifest, eol } = readManifest(pluginPath);

  const entryVaultDir = path.join(vaultDir, dir);
  const existingMeta = readVaultMeta(vaultDir, dir);
  let originalRecord = existingMeta?.original || null;

  // 仅在首次纳管时记录原始图标信息，防止后续重复更换覆盖掉最初出厂状态
  if (!originalRecord) {
    const origLogo = typeof manifest.logo === 'string' && manifest.logo.trim() ? manifest.logo.trim() : null;
    originalRecord = {
      originalLogo: origLogo,
      backupRelPath: null,
    };
    if (origLogo && !/^https?:\/\//i.test(origLogo)) {
      const origAbs = resolveWithinRoot(pluginPath, origLogo);
      if (origAbs && fs.existsSync(origAbs) && fs.statSync(origAbs).isFile()) {
        const origBackupDir = path.join(entryVaultDir, 'original');
        fs.mkdirSync(origBackupDir, { recursive: true });
        const backupName = path.basename(origAbs);
        fs.copyFileSync(origAbs, path.join(origBackupDir, backupName));
        originalRecord.backupRelPath = path.posix.join('original', backupName);
      }
    }
  }

  const targetRelLogo = 'assets/logo.png';
  const targetAbsLogo = path.join(pluginPath, 'assets', 'logo.png');
  const resizeInfo = resizeImageToPng(srcPath, targetAbsLogo, size);

  const customDir = path.join(entryVaultDir, 'custom');
  fs.mkdirSync(customDir, { recursive: true });
  const customLogoPath = path.join(customDir, 'logo.png');
  fs.copyFileSync(targetAbsLogo, customLogoPath);

  if (keepRaw) {
    const rawExt = path.extname(srcPath).toLowerCase() || '.png';
    fs.copyFileSync(srcPath, path.join(customDir, `raw${rawExt}`));
  }

  manifest.logo = targetRelLogo;
  writeManifest(manifestPath, manifest, eol);

  const meta = {
    schemaVersion: 1,
    dir,
    displayName: manifest.displayName || manifest.name || dir,
    style,
    size,
    targetLogo: targetRelLogo,
    customSha256: resizeInfo.sha256,
    bytes: resizeInfo.bytes,
    method: resizeInfo.method,
    resized: resizeInfo.resized,
    updatedAt: new Date().toISOString(),
    original: originalRecord,
  };
  fs.writeFileSync(path.join(entryVaultDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  return {
    ok: true,
    dir,
    targetLogo: targetRelLogo,
    targetAbsLogo,
    customVaultPath: customLogoPath,
    bytes: resizeInfo.bytes,
    sha256: resizeInfo.sha256,
    method: resizeInfo.method,
    resized: resizeInfo.resized,
    style,
  };
}

/**
 * 将本地插件目前正在使用的自定义图标直接归档到保险箱托管（不修改目标插件文件）。
 * @param {object} opts
 */
export function importCurrentToVault(opts = {}) {
  const { pluginsDir, vaultDir } = resolveDefaultPaths(opts);
  const dir = validatePluginDirName(opts.dir);
  const style = String(opts.style || 'custom').trim() || 'custom';

  const pluginPath = path.join(pluginsDir, dir);
  const { manifest } = readManifest(pluginPath);
  const rawLogo = typeof manifest.logo === 'string' ? manifest.logo.trim() : '';
  if (!rawLogo || /^https?:\/\//i.test(rawLogo)) {
    throw new Error(`插件 ${dir} 当前未使用本地相对路径 logo，无法归档: "${rawLogo}"`);
  }
  const absLogo = resolveWithinRoot(pluginPath, rawLogo);
  if (!absLogo || !fs.existsSync(absLogo) || !fs.statSync(absLogo).isFile()) {
    throw new Error(`插件 ${dir} 的图标文件不存在: ${rawLogo}`);
  }

  const entryVaultDir = path.join(vaultDir, dir);
  const customDir = path.join(entryVaultDir, 'custom');
  fs.mkdirSync(customDir, { recursive: true });
  const customLogoPath = path.join(customDir, 'logo.png');
  fs.copyFileSync(absLogo, customLogoPath);

  const existingMeta = readVaultMeta(vaultDir, dir);
  const normalizedTarget = rawLogo.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const sha = sha256File(absLogo);
  const bytes = fs.statSync(absLogo).size;

  const meta = {
    schemaVersion: 1,
    dir,
    displayName: manifest.displayName || manifest.name || dir,
    style,
    size: 256,
    targetLogo: normalizedTarget,
    customSha256: sha,
    bytes,
    method: 'imported-current',
    resized: false,
    updatedAt: new Date().toISOString(),
    original: existingMeta?.original || {
      originalLogo: normalizedTarget,
      backupRelPath: null,
      importedPreexisting: true,
    },
  };
  fs.writeFileSync(path.join(entryVaultDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  return {
    ok: true,
    dir,
    targetLogo: normalizedTarget,
    customVaultPath: customLogoPath,
    bytes,
    sha256: sha,
    style,
  };
}

/**
 * 上游更新覆盖后，从保险箱将保存的自定义图标写回对应插件。
 * @param {object} opts
 */
export function restoreIcons(opts = {}) {
  const { pluginsDir, vaultDir } = resolveDefaultPaths(opts);
  const targets = [];

  if (opts.dir) {
    targets.push(validatePluginDirName(opts.dir));
  } else if (opts.all) {
    if (fs.existsSync(vaultDir)) {
      for (const ent of fs.readdirSync(vaultDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (ent.isDirectory()) targets.push(ent.name);
      }
    }
  } else {
    throw new Error('请指定 --dir <插件目录> 或 --all');
  }

  const restored = [];
  const alreadyInSync = [];
  const missingPlugins = [];

  for (const dir of targets) {
    const meta = readVaultMeta(vaultDir, dir);
    const customFile = path.join(vaultDir, dir, 'custom', 'logo.png');
    if (!meta || !fs.existsSync(customFile)) continue;

    const pluginPath = path.join(pluginsDir, dir);
    const manifestPath = path.join(pluginPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      missingPlugins.push(dir);
      continue;
    }

    const { manifest, eol } = readManifest(pluginPath);
    const targetRelLogo = meta.targetLogo || 'assets/logo.png';
    const targetAbsLogo = resolveWithinRoot(pluginPath, targetRelLogo);
    if (!targetAbsLogo) {
      throw new Error(`保险箱记录中的目标路径非法: ${targetRelLogo}`);
    }

    const expectedSha = meta.customSha256 || sha256File(customFile);
    const normalizedCurrentLogo = typeof manifest.logo === 'string'
      ? manifest.logo.trim().replace(/\\/g, '/').replace(/^\.\/+/, '')
      : '';
    const currentExists = fs.existsSync(targetAbsLogo) && fs.statSync(targetAbsLogo).isFile();
    const currentSha = currentExists ? sha256File(targetAbsLogo) : '';

    if (normalizedCurrentLogo === targetRelLogo && currentSha === expectedSha) {
      alreadyInSync.push(dir);
      continue;
    }

    fs.mkdirSync(path.dirname(targetAbsLogo), { recursive: true });
    fs.copyFileSync(customFile, targetAbsLogo);
    manifest.logo = targetRelLogo;
    writeManifest(manifestPath, manifest, eol);
    restored.push(dir);
  }

  return { ok: true, restored, alreadyInSync, missingPlugins };
}

/**
 * 将单个插件无损回滚至更换前的原始 logo 配置与本地图标文件。
 * @param {object} opts
 */
export function revertIcon(opts = {}) {
  const { pluginsDir, vaultDir } = resolveDefaultPaths(opts);
  const dir = validatePluginDirName(opts.dir);
  const meta = readVaultMeta(vaultDir, dir);
  if (!meta) {
    throw new Error(`保险箱中未找到插件 ${dir} 的备份记录`);
  }

  const pluginPath = path.join(pluginsDir, dir);
  const { manifestPath, manifest, eol } = readManifest(pluginPath);
  const orig = meta.original || { originalLogo: null, backupRelPath: null };

  const targetRelLogo = meta.targetLogo || 'assets/logo.png';
  const targetAbsLogo = resolveWithinRoot(pluginPath, targetRelLogo);

  if (!orig.originalLogo) {
    delete manifest.logo;
    writeManifest(manifestPath, manifest, eol);
    if (targetAbsLogo && fs.existsSync(targetAbsLogo)) {
      fs.rmSync(targetAbsLogo, { force: true });
    }
    return { ok: true, dir, revertedLogo: null };
  }

  const normalizedOrig = orig.originalLogo.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (orig.backupRelPath) {
    const backupAbs = path.join(vaultDir, dir, orig.backupRelPath);
    const restoreOriginalAbs = resolveWithinRoot(pluginPath, orig.originalLogo);
    if (fs.existsSync(backupAbs) && restoreOriginalAbs) {
      fs.mkdirSync(path.dirname(restoreOriginalAbs), { recursive: true });
      fs.copyFileSync(backupAbs, restoreOriginalAbs);
    }
  }

  if (normalizedOrig !== targetRelLogo && targetAbsLogo && fs.existsSync(targetAbsLogo)) {
    fs.rmSync(targetAbsLogo, { force: true });
  }

  manifest.logo = orig.originalLogo;
  writeManifest(manifestPath, manifest, eol);
  return { ok: true, dir, revertedLogo: orig.originalLogo };
}

/**
 * 列出保险箱中的全部备份条目并校验当前插件是否发生漂移。
 * @param {object} [opts]
 */
export function listVault(opts = {}) {
  const { pluginsDir, vaultDir } = resolveDefaultPaths(opts);
  if (!fs.existsSync(vaultDir)) {
    return { vaultDir, count: 0, entries: [] };
  }
  const scanRes = scanPlugins({ pluginsDir, vaultDir });
  const byDir = new Map(scanRes.plugins.map((p) => [p.dir, p]));
  const entries = [];

  for (const ent of fs.readdirSync(vaultDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!ent.isDirectory()) continue;
    const meta = readVaultMeta(vaultDir, ent.name);
    if (!meta) continue;
    const live = byDir.get(ent.name);
    entries.push({
      dir: ent.name,
      displayName: live?.displayName || meta.displayName || ent.name,
      style: meta.style || '',
      bytes: meta.bytes || 0,
      updatedAt: meta.updatedAt || '',
      installed: Boolean(live),
      drifted: live ? live.drifted : false,
      originalLogo: meta.original?.originalLogo ?? null,
    });
  }
  return { vaultDir, count: entries.length, entries };
}

/**
 * 解析命令行参数。
 * @param {string[]} argv
 */
function parseCliArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function printHumanScan(res) {
  const s = res.summary;
  console.log(`插件目录: ${res.pluginsDir}`);
  console.log(`图标保险箱: ${res.vaultDir}`);
  console.log(
    `汇总: 共 ${s.total} 个插件 | 位图 ${s.localRaster} | 简单SVG ${s.localSvg} | 缺失 ${s.missing} | 外链 ${s.remoteHttps} | 失效 ${s.broken} | 已入库 ${s.vaultBacked} | 待还原漂移 ${s.drifted}`,
  );
  console.log('');
  for (const p of res.plugins) {
    const tags = [p.logoType];
    if (p.vaultBacked) tags.push(p.drifted ? 'DRIFTED' : 'vault-ok');
    console.log(`- ${p.dir} (${p.displayName}) [${tags.join(', ')}] logo=${p.logo || '(empty)'}`);
  }
}

function main() {
  const { positional, flags } = parseCliArgs(process.argv.slice(2));
  const cmd = positional[0] || 'help';
  const sub = positional[1] || '';
  const asJson = Boolean(flags.json);
  const baseOpts = {
    pluginsDir: typeof flags['plugins-dir'] === 'string' ? flags['plugins-dir'] : undefined,
    vaultDir: typeof flags['vault-dir'] === 'string' ? flags['vault-dir'] : undefined,
  };

  let output;
  if (cmd === 'scan') {
    output = scanPlugins(baseOpts);
    if (!asJson) {
      printHumanScan(output);
      return;
    }
  } else if (cmd === 'apply') {
    output = applyIcon({
      ...baseOpts,
      dir: flags.dir,
      src: flags.src,
      size: flags.size,
      style: flags.style,
      keepRaw: Boolean(flags['keep-raw']),
    });
  } else if (cmd === 'restore') {
    output = restoreIcons({
      ...baseOpts,
      dir: typeof flags.dir === 'string' ? flags.dir : '',
      all: Boolean(flags.all),
    });
  } else if (cmd === 'revert') {
    output = revertIcon({
      ...baseOpts,
      dir: flags.dir,
    });
  } else if (cmd === 'vault' && (sub === 'list' || !sub)) {
    output = listVault(baseOpts);
  } else if (cmd === 'vault' && sub === 'import-current') {
    output = importCurrentToVault({
      ...baseOpts,
      dir: flags.dir,
      style: flags.style,
    });
  } else {
    console.log([
      'AGY Icon Studio CLI (bin/icon-studio.mjs)',
      '',
      '用法:',
      '  node bin/icon-studio.mjs scan [--json] [--plugins-dir <dir>] [--vault-dir <dir>]',
      '  node bin/icon-studio.mjs apply --dir <plugin> --src <image> [--size 256] [--style <label>] [--keep-raw] [--json]',
      '  node bin/icon-studio.mjs restore [--dir <plugin> | --all] [--json]',
      '  node bin/icon-studio.mjs revert --dir <plugin> [--json]',
      '  node bin/icon-studio.mjs vault list [--json]',
      '  node bin/icon-studio.mjs vault import-current --dir <plugin> [--style <label>] [--json]',
    ].join('\n'));
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

const isMainEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainEntry) {
  try {
    main();
  } catch (err) {
    console.error(`[agy-icon-studio error] ${err?.message || String(err)}`);
    process.exit(1);
  }
}
