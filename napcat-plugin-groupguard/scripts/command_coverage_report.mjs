import fs from 'fs';
import path from 'path';

const root = process.cwd();
const manifestFile = path.join(root, 'scripts', 'legacy_command_manifest.json');
const modulesDir = path.join(root, 'src', 'commands', 'modules');
const outFile = path.join(root, 'COMMAND_COVERAGE_REPORT.md');

const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const moduleFiles = fs.readdirSync(modulesDir).filter(f => f.endsWith('.ts')).sort();

function extractCommandChecks(content) {
  const result = [];
  const reStarts = /text\.startsWith\('([^']+)'\)/g;
  const reEqSingle = /text\s*===\s*'([^']+)'/g;
  const reEqDouble = /text\s*===\s*"([^"]+)"/g;
  let m;
  while ((m = reStarts.exec(content))) result.push({ type: 'startsWith', value: m[1] });
  while ((m = reEqSingle.exec(content))) result.push({ type: 'exact', value: m[1] });
  while ((m = reEqDouble.exec(content))) result.push({ type: 'exact', value: m[1] });
  return result;
}

function extractMatcherCommands(content) {
  const prefixes = [];
  const exact = [];
  const prefixBlock = content.match(/export const [A-Z_]+_PREFIXES = \[([\s\S]*?)\];/);
  const exactBlock = content.match(/export const [A-Z_]+_EXACT = \[([\s\S]*?)\];/);
  if (prefixBlock) {
    for (const m of prefixBlock[1].matchAll(/'([^']+)'/g)) prefixes.push(m[1]);
  }
  if (exactBlock) {
    for (const m of exactBlock[1].matchAll(/'([^']+)'/g)) exact.push(m[1]);
  }
  return { prefixes, exact };
}

const legacyCommands = [
  ...manifest.exact.map((value) => ({ type: 'exact', value })),
  ...manifest.prefix.map((value) => ({ type: 'startsWith', value }))
];

const moduleMatchers = [];
const moduleHandled = [];
for (const file of moduleFiles) {
  const fp = path.join(modulesDir, file);
  const content = fs.readFileSync(fp, 'utf8');
  const { prefixes, exact } = extractMatcherCommands(content);
  const checks = extractCommandChecks(content);
  moduleMatchers.push({ file, prefixes, exact });
  moduleHandled.push({ file, checks });
}

function isCoveredByMatcher(cmd) {
  for (const m of moduleMatchers) {
    if (cmd.type === 'exact' && m.exact.includes(cmd.value)) return { covered: true, by: `${m.file}:exact` };
    if (cmd.type === 'startsWith' && m.prefixes.includes(cmd.value)) return { covered: true, by: `${m.file}:prefix` };
  }
  return { covered: false, by: '' };
}

function isHandledInModules(cmd) {
  for (const m of moduleHandled) {
    if (m.checks.some(c => c.type === cmd.type && c.value === cmd.value)) return { handled: true, by: m.file };
  }
  return { handled: false, by: '' };
}

const rows = legacyCommands.map(cmd => {
  const matcher = isCoveredByMatcher(cmd);
  const handled = isHandledInModules(cmd);
  return {
    command: cmd.value,
    type: cmd.type,
    matcherCovered: matcher.covered,
    matcherBy: matcher.by,
    handledInModules: handled.handled,
    handledBy: handled.by,
    status: matcher.covered && handled.handled ? 'OK' : 'UNMATCHED'
  };
});

const total = rows.length;
const ok = rows.filter(r => r.status === 'OK').length;
const unmatched = rows.filter(r => r.status !== 'OK');

const lines = [];
lines.push('# 命令覆盖报告');
lines.push('');
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push(`- legacy 命令数量（去重后）：${total}`);
lines.push(`- 新路由完整命中数量：${ok}`);
lines.push(`- 未匹配数量：${unmatched.length}`);
lines.push(`- 覆盖率：${total ? ((ok / total) * 100).toFixed(2) : '100.00'}%`);
lines.push('');
lines.push('## 模块 matcher 摘要');
lines.push('');
for (const m of moduleMatchers) {
  lines.push(`- ${m.file}: exact=${m.exact.length}, prefixes=${m.prefixes.length}`);
}
lines.push('');
lines.push('## 详细命中表');
lines.push('');
lines.push('| 命令 | 类型 | matcher覆盖 | 处理实现 | 状态 |');
lines.push('| --- | --- | --- | --- | --- |');
for (const r of rows) {
  const matcher = r.matcherCovered ? `✅ ${r.matcherBy}` : '❌';
  const handled = r.handledInModules ? `✅ ${r.handledBy}` : '❌';
  lines.push(`| ${r.command} | ${r.type} | ${matcher} | ${handled} | ${r.status} |`);
}
lines.push('');
lines.push('## 未匹配命令');
lines.push('');
if (!unmatched.length) lines.push('- 无');
else unmatched.forEach(r => lines.push(`- ${r.type}:${r.command}`));
lines.push('');

fs.writeFileSync(outFile, `${lines.join('\n')}\n`, 'utf8');
console.log(`report saved: ${outFile}`);
