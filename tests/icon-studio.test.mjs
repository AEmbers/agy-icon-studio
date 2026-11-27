import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import {
  applyIcon,
  importCurrentToVault,
  listVault,
  restoreIcons,
  revertIcon,
  scanPlugins,
  validatePluginDirName,
} from '../bin/icon-studio.mjs';

/**
 * 写入一个极简合法 1x1 PNG 文件（纯 Node 构造，避免依赖外部测试图片）。
 * @param {string} targetPath
 * @param {number} [variantByte] 修改末尾无关数据或调色字节以产生不同 SHA256
 */
function writeSamplePng(targetPath, variantByte = 0x00) {
  // 标准 1x1 RGBA PNG（经过 zlib 压缩，使用固定合法像素块，支持在各平台被图形库真实解码）
  const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (variantByte === 0) {
    fs.writeFileSync(targetPath, basePng);
  } else {
    // 追加合法 PNG 尾部之后？部分解码器会忽略 tEXt，用 tEXt chunk 插在 IEND 之前更规范
    const beforeIend = basePng.subarray(0, basePng.length - 12);
    const iend = basePng.subarray(basePng.length - 12);
    // 构造一个带不同字节的 tEXt chunk ("Comment\0x")，但保持 CRC 有效可用 Python/简单 1x1 颜色？
    // 直接使用两个真实预计算合法 1x1 PNG（透明红 vs 透明蓝）更稳妥！
    const altPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    fs.writeFileSync(targetPath, variantByte === 1 ? altPng : basePng);
    void beforeIend;
    void iend;
  }
}

function createSandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-icon-studio-test-'));
  const pluginsDir = path.join(root, 'plugins');
  const vaultDir = path.join(root, 'icon-vault');
  fs.mkdirSync(pluginsDir, { recursive: true });

  // 1. 缺图标插件
  fs.mkdirSync(path.join(pluginsDir, 'p-missing'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginsDir, 'p-missing', 'plugin.json'),
    JSON.stringify({ name: 'p-missing', version: '1.0.0', description: 'missing logo' }, null, 2),
  );

  // 2. 简陋 SVG 插件
  fs.mkdirSync(path.join(pluginsDir, 'p-svg', 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginsDir, 'p-svg', 'assets', 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6"/></svg>',
  );
  fs.writeFileSync(
    path.join(pluginsDir, 'p-svg', 'plugin.json'),
    JSON.stringify({ name: 'p-svg', version: '1.0.0', logo: 'assets/logo.svg' }, null, 2),
  );

  // 3. 官方外链 HTTPS 插件
  fs.mkdirSync(path.join(pluginsDir, 'p-remote'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginsDir, 'p-remote', 'plugin.json'),
    JSON.stringify({ name: 'p-remote', logo: 'https://www.gstatic.com/example.png' }, null, 2),
  );

  // 4. 失效路径插件
  fs.mkdirSync(path.join(pluginsDir, 'p-broken'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginsDir, 'p-broken', 'plugin.json'),
    JSON.stringify({ name: 'p-broken', logo: 'assets/not-found.png' }, null, 2),
  );

  // 5. 现有本地位图插件（用于测试 import-current）
  const pRasterImg = path.join(pluginsDir, 'p-raster', 'assets', 'logo.png');
  writeSamplePng(pRasterImg, 1);
  fs.writeFileSync(
    path.join(pluginsDir, 'p-raster', 'plugin.json'),
    JSON.stringify({ name: 'p-raster', logo: 'assets/logo.png' }, null, 2),
  );

  const srcNewPng = path.join(root, 'generated-art.png');
  writeSamplePng(srcNewPng, 0);

  return { root, pluginsDir, vaultDir, srcNewPng };
}

test('validatePluginDirName 拦截路径穿越和非法字符', () => {
  assert.equal(validatePluginDirName('colab-forge'), 'colab-forge');
  assert.throws(() => validatePluginDirName('..'), /非法的插件目录名/);
  assert.throws(() => validatePluginDirName('../evil'), /非法的插件目录名/);
  assert.throws(() => validatePluginDirName('a/b'), /非法的插件目录名/);
  assert.throws(() => validatePluginDirName('a\\b'), /非法的插件目录名/);
  assert.throws(() => validatePluginDirName(''), /非法的插件目录名/);
});

test('scanPlugins 准确识别各类插件图标状态', () => {
  const sb = createSandbox();
  try {
    const res = scanPlugins({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir });
    assert.equal(res.summary.total, 5);
    assert.equal(res.summary.missing, 1);
    assert.equal(res.summary.localSvg, 1);
    assert.equal(res.summary.remoteHttps, 1);
    assert.equal(res.summary.broken, 1);
    assert.equal(res.summary.localRaster, 1);

    const byDir = new Map(res.plugins.map((p) => [p.dir, p]));
    assert.equal(byDir.get('p-missing').logoType, 'missing');
    assert.equal(byDir.get('p-svg').logoType, 'local-svg');
    assert.equal(byDir.get('p-remote').logoType, 'remote-https');
    assert.equal(byDir.get('p-broken').logoType, 'broken');
    assert.equal(byDir.get('p-raster').logoType, 'local-raster');
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('apply -> 上游覆盖产生 drifted -> restore 一键还原 -> revert 无损回滚全流程', () => {
  const sb = createSandbox();
  try {
    // A. 对无图标插件和 SVG 插件分别更换新图标
    const r1 = applyIcon({
      pluginsDir: sb.pluginsDir,
      vaultDir: sb.vaultDir,
      dir: 'p-missing',
      src: sb.srcNewPng,
      size: 128,
      style: 'ai-girls-universe',
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.targetLogo, 'assets/logo.png');
    assert.ok(fs.existsSync(r1.targetAbsLogo));
    assert.ok(fs.existsSync(r1.customVaultPath));

    const r2 = applyIcon({
      pluginsDir: sb.pluginsDir,
      vaultDir: sb.vaultDir,
      dir: 'p-svg',
      src: sb.srcNewPng,
      size: 128,
      style: 'ai-girls-universe',
    });
    assert.equal(r2.ok, true);

    // 验证 scan 显示已入库且未漂移
    let scan1 = scanPlugins({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir });
    assert.equal(scan1.summary.vaultBacked, 2);
    assert.equal(scan1.summary.drifted, 0);

    // B. 模拟上游插件更新，覆盖 p-svg 的 plugin.json 为旧 SVG 图标
    const pSvgJson = path.join(sb.pluginsDir, 'p-svg', 'plugin.json');
    fs.writeFileSync(pSvgJson, JSON.stringify({ name: 'p-svg', version: '2.0.0', logo: 'assets/logo.svg' }, null, 2));

    let scan2 = scanPlugins({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir });
    assert.equal(scan2.summary.drifted, 1);
    const pSvgEntry = scan2.plugins.find((p) => p.dir === 'p-svg');
    assert.equal(pSvgEntry.drifted, true);

    // C. 执行 restore --all 一键恢复
    const rest = restoreIcons({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir, all: true });
    assert.deepEqual(rest.restored, ['p-svg']);
    assert.deepEqual(rest.alreadyInSync, ['p-missing']);
    assert.deepEqual(rest.missingPlugins, []);

    const restoredManifest = JSON.parse(fs.readFileSync(pSvgJson, 'utf8'));
    assert.equal(restoredManifest.version, '2.0.0'); // 保留更新后的版本号，仅还原图标
    assert.equal(restoredManifest.logo, 'assets/logo.png');

    // D. 执行 revert 分别回滚两个插件至出厂原貌
    const revMissing = revertIcon({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir, dir: 'p-missing' });
    assert.equal(revMissing.revertedLogo, null);
    const missingManifest = JSON.parse(fs.readFileSync(path.join(sb.pluginsDir, 'p-missing', 'plugin.json'), 'utf8'));
    assert.equal('logo' in missingManifest, false);
    assert.equal(fs.existsSync(path.join(sb.pluginsDir, 'p-missing', 'assets', 'logo.png')), false);

    const revSvg = revertIcon({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir, dir: 'p-svg' });
    assert.equal(revSvg.revertedLogo, 'assets/logo.svg');
    const svgManifest = JSON.parse(fs.readFileSync(pSvgJson, 'utf8'));
    assert.equal(svgManifest.logo, 'assets/logo.svg');
    assert.equal(fs.existsSync(path.join(sb.pluginsDir, 'p-svg', 'assets', 'logo.svg')), true);
    assert.equal(fs.existsSync(path.join(sb.pluginsDir, 'p-svg', 'assets', 'logo.png')), false);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});

test('importCurrentToVault + listVault + CLI --json 端到端测试', () => {
  const sb = createSandbox();
  try {
    const imp = importCurrentToVault({
      pluginsDir: sb.pluginsDir,
      vaultDir: sb.vaultDir,
      dir: 'p-raster',
      style: 'ai-girls-universe',
    });
    assert.equal(imp.ok, true);
    assert.ok(fs.existsSync(imp.customVaultPath));

    const vaultInfo = listVault({ pluginsDir: sb.pluginsDir, vaultDir: sb.vaultDir });
    assert.equal(vaultInfo.count, 1);
    assert.equal(vaultInfo.entries[0].dir, 'p-raster');
    assert.equal(vaultInfo.entries[0].drifted, false);

    const cliPath = path.resolve(import.meta.dirname, '..', 'bin', 'icon-studio.mjs');
    const out = execFileSync(
      process.execPath,
      [cliPath, 'scan', '--json', '--plugins-dir', sb.pluginsDir, '--vault-dir', sb.vaultDir],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(out);
    assert.equal(parsed.summary.total, 5);
    assert.equal(parsed.summary.vaultBacked, 1);
  } finally {
    fs.rmSync(sb.root, { recursive: true, force: true });
  }
});
