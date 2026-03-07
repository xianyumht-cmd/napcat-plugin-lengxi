import fs from 'fs/promises';
import path from 'path';

const rootDir = process.cwd();
const modulesDir = path.join(rootDir, 'src', 'commands', 'modules');
const outFile = path.join(rootDir, 'SCENE_COVERAGE_REPORT.md');

function extractSceneFromSendScene(line) {
  const m = line.match(/send(?:Group|Private)Scene\([^,]+,\s*([^,]+),/);
  return m ? m[1].trim() : null;
}

function extractSceneFromSendGroupMsg(line) {
  if (!line.includes('sendGroupMsg(') || !line.includes('scene:')) return null;
  const m = line.match(/scene:\s*([^,}\]]+)/);
  return m ? m[1].trim() : null;
}

function stripQuotes(value) {
  const m = value.match(/^['"](.+)['"]$/);
  return m ? m[1] : value;
}

function classifySceneExpr(expr) {
  const rawLiteral = /^['"]raw_text['"]$/;
  if (rawLiteral.test(expr)) return 'raw_literal';
  if (expr.includes("'raw_text'") || expr.includes('"raw_text"')) return 'raw_mixed';
  if (/^['"][a-z0-9_]+['"]$/i.test(expr)) return 'scene_literal';
  return 'scene_expr';
}

function rel(file) {
  return path.relative(rootDir, file).replace(/\\/g, '/');
}

const files = (await fs.readdir(modulesDir))
  .filter(name => name.endsWith('.ts'))
  .map(name => path.join(modulesDir, name))
  .sort((a, b) => a.localeCompare(b));

const perModule = [];
const remainingRaw = [];
const sceneUsage = new Map();

let totalSceneCalls = 0;
let rawCalls = 0;
let rawLiteralCalls = 0;
let rawMixedCalls = 0;
let directLegacyCalls = 0;

for (const file of files) {
  const content = await fs.readFile(file, 'utf8');
  const lines = content.split(/\r?\n/);
  let moduleTotal = 0;
  let moduleRaw = 0;
  let moduleLegacy = 0;

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const sceneExpr = extractSceneFromSendScene(line) || extractSceneFromSendGroupMsg(line);
    if (sceneExpr) {
      totalSceneCalls++;
      moduleTotal++;
      const cls = classifySceneExpr(sceneExpr);
      if (cls === 'raw_literal' || cls === 'raw_mixed') {
        rawCalls++;
        moduleRaw++;
        if (cls === 'raw_literal') rawLiteralCalls++;
        if (cls === 'raw_mixed') rawMixedCalls++;
        remainingRaw.push({
          file: rel(file),
          line: lineNo,
          expr: sceneExpr,
          code: line.trim()
        });
      }
      if (cls === 'scene_literal') {
        const sceneName = stripQuotes(sceneExpr);
        sceneUsage.set(sceneName, (sceneUsage.get(sceneName) || 0) + 1);
      }
      return;
    }

    if (line.includes('pluginState.sendGroupText(') || line.includes('pluginState.sendPrivateMsg(')) {
      directLegacyCalls++;
      moduleLegacy++;
    }
  });

  perModule.push({
    module: path.basename(file, '.ts'),
    total: moduleTotal,
    raw: moduleRaw,
    nonRaw: moduleTotal - moduleRaw,
    legacy: moduleLegacy
  });
}

const globalCoverage = totalSceneCalls ? ((totalSceneCalls - rawCalls) / totalSceneCalls) * 100 : 100;
const generatedAt = new Date().toISOString();
const scenesSorted = Array.from(sceneUsage.entries()).sort((a, b) => b[1] - a[1]);

const lines = [];
lines.push('# Scene 覆盖率报告');
lines.push('');
lines.push(`- 生成时间: ${generatedAt}`);
lines.push(`- 扫描范围: src/commands/modules/*.ts`);
lines.push(`- Scene 调用总数: ${totalSceneCalls}`);
lines.push(`- raw_text 调用总数: ${rawCalls}`);
lines.push(`- raw_text 纯字面量: ${rawLiteralCalls}`);
lines.push(`- raw_text 条件表达式: ${rawMixedCalls}`);
lines.push(`- 非 raw_text 覆盖率: ${globalCoverage.toFixed(2)}%`);
lines.push(`- 直连 legacy 发送调用数: ${directLegacyCalls}`);
lines.push('');
lines.push('## 模块统计');
lines.push('');
lines.push('| 模块 | Scene总数 | raw_text | 非raw | 覆盖率 | Legacy直连 |');
lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const row of perModule) {
  const rate = row.total ? (row.nonRaw / row.total) * 100 : 100;
  lines.push(`| ${row.module} | ${row.total} | ${row.raw} | ${row.nonRaw} | ${rate.toFixed(2)}% | ${row.legacy} |`);
}
lines.push('');
lines.push('## 剩余 raw_text 清单');
lines.push('');
if (!remainingRaw.length) {
  lines.push('- 无剩余 raw_text 调用');
} else {
  for (const item of remainingRaw) {
    lines.push(`- ${item.file}:${item.line} | scene=${item.expr} | ${item.code}`);
  }
}
lines.push('');
lines.push('## Scene 使用分布（字面量）');
lines.push('');
if (!scenesSorted.length) {
  lines.push('- 暂无可统计的字面量 scene');
} else {
  for (const [scene, count] of scenesSorted) {
    lines.push(`- ${scene}: ${count}`);
  }
}
lines.push('');

await fs.writeFile(outFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`Scene coverage report written to: ${outFile}`);
