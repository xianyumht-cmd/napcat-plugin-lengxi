import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../state';
import fs from 'fs';
import { storageAdapter } from '../storage_adapter';

export function extractAt(raw: string): string | null {
  const m = raw.match(/\[CQ:at,qq=(\d+)\]/);
  return m ? m[1] : null;
}

export function extractQQ(text: string): string | null {
  const m = text.match(/(\d{5,12})/);
  return m ? m[1] : null;
}

export function getTarget(raw: string, textAfterCmd: string): string | null {
  return extractAt(raw) || extractQQ(textAfterCmd);
}

export async function isAdminOrOwner(groupId: string, userId: string): Promise<boolean> {
  if (pluginState.isOwner(userId)) return true;
  const key = `${groupId}:${userId}`;
  const settings = pluginState.getGroupSettings(groupId);
  const cacheSeconds = settings.adminCacheSeconds !== undefined ? settings.adminCacheSeconds : 60;
  if (cacheSeconds > 0) {
    const cached = pluginState.adminCache.get(key);
    if (cached && Date.now() < cached.expire) {
      return cached.role === 'admin' || cached.role === 'owner';
    }
  }
  const info = await pluginState.callApi('get_group_member_info', { group_id: groupId, user_id: userId }) as any;
  const role = info?.role || 'member';
  if (cacheSeconds > 0) {
    pluginState.adminCache.set(key, { role, expire: Date.now() + cacheSeconds * 1000 });
  }
  return role === 'admin' || role === 'owner';
}

export function saveConfig(ctx: NapCatPluginContext): void {
  try {
    if (ctx?.configPath) {
      const mainConfig = { ...pluginState.config, groups: {} };
      fs.writeFileSync(ctx.configPath, JSON.stringify(mainConfig, null, 2), 'utf-8');
      storageAdapter.saveGroupConfigs(pluginState.config.groups || {});
    }
  } catch (e) {
    pluginState.log('error', `保存配置失败: ${e}`);
  }
}

export async function sendGroupScene(groupId: string, scene: string, fallback: string, vars?: Record<string, string | number | boolean>): Promise<void> {
  await pluginState.sendGroupText(groupId, fallback, { scene, vars, force: true, applyTemplate: true });
}

export async function sendPrivateScene(userId: string, scene: string, fallback: string, vars?: Record<string, string | number | boolean>): Promise<void> {
  await pluginState.sendPrivateMsg(userId, fallback, { scene, vars, force: true, applyTemplate: true });
}
