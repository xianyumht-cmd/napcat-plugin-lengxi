#!/usr/bin/env node
/**
 * 增量构建：只构建有变更的插件，未变更的插件直接从 package.json 收集信息写入 plugin.json。
 *
 * 用法: node .github/scripts/build-plugins.mjs <repo_url> <release_tag> [--all]
 *   --all  强制构建全部插件（workflow_dispatch 时使用）
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const REPO_URL = process.argv[2] || 'https://github.com/user/repo';
const RELEASE_TAG = process.argv[3] || 'plugins';
const FORCE_ALL = process.argv.includes('--all');
const ROOT = process.cwd();
const OUT_DIR = join(ROOT, '.plugin-zips');

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// 检测哪些插件目录有变更
// 优先使用 BEFORE_SHA 环境变量（由 workflow 传入 github.event.before）
// 回退到 HEAD~1
function getChangedPlugins () {
  try {
    const beforeSha = process.env.BEFORE_SHA || '';
    let diffCmd;
    if (beforeSha && beforeSha !== '0000000000000000000000000000000000000000') {
      diffCmd = `git diff --name-only ${beforeSha} HEAD`;
    } else {
      diffCmd = 'git diff --name-only HEAD~1 HEAD';
    }
    console.log(`📋 变更检测: ${diffCmd}`);
    const diff = execSync(diffCmd, { encoding: 'utf8' }).trim();
    if (!diff) return new Set();
    const changed = new Set();
    for (const file of diff.split('\n')) {
      const match = file.match(/^(napcat-plugin-[^/]+)\//);
      if (match) changed.add(match[1]);
    }
    return changed;
  } catch {
    // 首次提交或无法 diff 时，构建全部
    return null;
  }
}

// 扫描所有插件目录
const pluginDirs = readdirSync(ROOT, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name.startsWith('napcat-plugin-'))
  .map(d => d.name);

const changedSet = FORCE_ALL ? null : getChangedPlugins();
const buildAll = FORCE_ALL || changedSet === null;

if (buildAll) {
  console.log(`🔨 全量构建模式，共 ${pluginDirs.length} 个插件\n`);
} else if (changedSet.size === 0) {
  console.log(`✅ 没有插件目录变更，跳过构建\n`);
} else {
  console.log(`🔍 检测到 ${changedSet.size} 个插件有变更: ${[...changedSet].join(', ')}\n`);
}

const allPluginInfos = [];
const builtNames = [];

for (const dirName of pluginDirs) {
  const pluginPath = join(ROOT, dirName);
  const pkgPath = join(pluginPath, 'package.json');

  if (!existsSync(pkgPath)) {
    console.log(`⏭️  跳过 ${dirName} (无 package.json)`);
    continue;
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  if (!pkg.name || !pkg.scripts?.build) {
    console.log(`⏭️  跳过 ${dirName} (无 name 或 build 脚本)`);
    continue;
  }

  const zipName = `${pkg.name}.zip`;
  const downloadUrl = `${REPO_URL}/releases/download/${RELEASE_TAG}/${zipName}`;
  const pluginInfo = {
    id: pkg.name,
    name: pkg.plugin || pkg.name,
    version: pkg.version,
    description: pkg.description || '',
    author: pkg.author || '',
    homepage: pkg.napcat?.homepage || '',
    downloadUrl,
    tags: pkg.napcat?.tags || [],
    minVersion: pkg.napcat?.minVersion || '4.14.0',
  };

  // 判断是否需要构建
  const needsBuild = buildAll || changedSet.has(dirName);

  if (!needsBuild) {
    console.log(`⏩ 未变更，跳过构建: ${pkg.name} v${pkg.version}`);
    allPluginInfos.push(pluginInfo);
    continue;
  }

  console.log(`==========================================`);
  console.log(`🔨 构建: ${pkg.name} v${pkg.version}`);
  console.log(`==========================================`);

  // 安装依赖
  try {
    if (existsSync(join(pluginPath, 'pnpm-lock.yaml'))) {
      execSync('pnpm install', { cwd: pluginPath, stdio: 'inherit' });
    } else if (existsSync(join(pluginPath, 'package-lock.json'))) {
      execSync('npm install', { cwd: pluginPath, stdio: 'inherit' });
    } else {
      execSync('npm install', { cwd: pluginPath, stdio: 'inherit' });
    }
  } catch {
    console.log(`⚠️  依赖安装警告: ${pkg.name}`);
  }

  // 构建
  try {
    execSync('npm run build', { cwd: pluginPath, stdio: 'inherit' });
  } catch {
    console.log(`❌ 构建失败: ${pkg.name}`);
    allPluginInfos.push(pluginInfo); // 构建失败也保留信息（版本不变）
    continue;
  }

  const distDir = join(pluginPath, 'dist');
  if (!existsSync(distDir)) {
    console.log(`❌ 无 dist 目录: ${pkg.name}`);
    allPluginInfos.push(pluginInfo);
    continue;
  }

  // 打包
  const stagingDir = join(OUT_DIR, `staging-${pkg.name}`, pkg.name);
  mkdirSync(stagingDir, { recursive: true });
  cpSync(distDir, stagingDir, { recursive: true });

  // 生成干净的 package.json（如果 dist 里没有）
  if (!existsSync(join(stagingDir, 'package.json'))) {
    const cleanPkg = {
      name: pkg.name,
      plugin: pkg.plugin,
      version: pkg.version,
      type: pkg.type || 'module',
      main: (pkg.main || 'index.mjs').replace(/^dist\//, ''),
      description: pkg.description,
      author: pkg.author,
      napcat: pkg.napcat,
      dependencies: pkg.dependencies,
    };
    writeFileSync(join(stagingDir, 'package.json'), JSON.stringify(cleanPkg, null, 2));
  }

  // 复制 webui（如果存在且 dist 中没有）
  const webuiSrc = join(pluginPath, 'webui');
  if (existsSync(webuiSrc) && !existsSync(join(stagingDir, 'webui'))) {
    cpSync(webuiSrc, join(stagingDir, 'webui'), { recursive: true });
  }

  // 复制 resources（如果存在且 dist 中没有）
  const resSrc = join(pluginPath, 'resources');
  if (existsSync(resSrc) && !existsSync(join(stagingDir, 'resources'))) {
    cpSync(resSrc, join(stagingDir, 'resources'), { recursive: true });
  }

  // 创建 zip
  const zipPath = join(OUT_DIR, zipName);
  const stagingParent = join(OUT_DIR, `staging-${pkg.name}`);
  execSync(`zip -r "${zipPath}" "${pkg.name}"`, { cwd: stagingParent, stdio: 'inherit' });
  rmSync(stagingParent, { recursive: true });

  console.log(`✅ 打包完成: ${zipName}\n`);
  builtNames.push(pkg.name);
  allPluginInfos.push(pluginInfo);
}

// 更新 plugin.json（始终包含全部插件信息）
const pluginJsonPath = join(ROOT, 'plugin.json');
const result = {
  version: '1.0.0',
  updateTime: new Date().toISOString().replace(/\.\d{3}Z/, 'Z'),
  plugins: allPluginInfos,
};

writeFileSync(pluginJsonPath, JSON.stringify(result, null, 2) + '\n');

if (builtNames.length > 0) {
  console.log(`\n✅ 本次构建了 ${builtNames.length} 个插件: ${builtNames.join(', ')}`);
} else {
  console.log(`\n✅ 无需构建`);
}
console.log(`📋 plugin.json 已更新，共 ${allPluginInfos.length} 个插件`);
