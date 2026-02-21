// 配置管理：加载、保存
import fs from 'fs';
import path from 'path';
import { state, DEFAULT_CONFIG } from './state';

export function saveConfig (): void {
  if (!state.configPath) return;
  try {
    const dir = path.dirname(state.configPath);
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(state.configPath, JSON.stringify(state.config, null, 2));
  } catch { /* ignore */ }
}

export function loadConfigFromFile (): void {
  if (!state.configPath || !fs.existsSync(state.configPath)) return;
  try {
    const saved = JSON.parse(fs.readFileSync(state.configPath, 'utf-8'));
    state.config = {
      ...DEFAULT_CONFIG, ...saved,
      qqbot: { ...DEFAULT_CONFIG.qqbot!, ...(saved.qqbot || {}) },
    };
    // 兼容旧配置：给 rules 补上新字段
    if (Array.isArray(state.config.rules)) {
      state.config.rules = state.config.rules.map(r => ({
        ...r,
        ownerOnly: r.ownerOnly || false,
      }));
    }
  } catch { /* ignore */ }
}

export function getInstalledPlugins (): string[] {
  if (!state.pluginManagerRef) return [];
  try {
    const plugins = state.pluginManagerRef.getAllPlugins?.() || state.pluginManagerRef.getLoadedPlugins?.() || [];
    return plugins.map((p: any) => p.id || p.name || p.dirname).filter((n: string) => n && n !== 'napcat-plugin-amsghook');
  } catch { return []; }
}
