import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../../state';
import { authManager } from '../../auth';
import { saveConfig, isAdminOrOwner, sendPrivateScene } from '../common';

export const AUTH_PREFIXES = [
  '授权 ',
  '回收授权 ',
  '查询授权 ',
  '激活 '
];

export const AUTH_EXACT = [
  '查询授权',
  '授权状态',
  '授权查询'
];

export function matchAuthCommand(text: string): string | null {
  if (AUTH_EXACT.includes(text)) return text;
  for (const p of AUTH_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleAuthCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');

  if (event.message_type === 'private') {
    const isOwner = pluginState.isOwner(userId);
    if (!isOwner) {
      pluginState.log('warn', `非主人用户 ${userId} 尝试执行私聊授权指令 [${text}] 被拦截`);
      await sendPrivateScene(userId, 'permission_denied', '权限不足：该指令仅限机器人主人使用。');
      return true;
    }
    if (text.startsWith('授权 ')) {
      const parts = text.split(' ');
      if (parts.length < 3) {
        await sendPrivateScene(userId, 'command_format_error', '格式错误：授权 <群号> <天数>', { example: '授权 123456 30' });
        return true;
      }
      const targetGroup = parts[1];
      const duration = parts[2];
      const days = duration === '永久' ? -1 : parseInt(duration);
      if (!/^\d+$/.test(targetGroup)) {
        await sendPrivateScene(userId, 'command_format_error', '群号格式错误', { example: '授权 123456 30' });
        return true;
      }
      authManager.grantLicense(targetGroup, days, days === -1 ? 'enterprise' : 'pro');
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `已授权群 ${targetGroup} ${duration === '永久' ? '永久' : days + '天'}`);
      return true;
    }
    if (text.startsWith('回收授权 ')) {
      const targetGroup = text.split(' ')[1];
      if (!targetGroup) return true;
      authManager.revokeLicense(targetGroup);
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `已回收群 ${targetGroup} 授权`);
      return true;
    }
    if (text.startsWith('查询授权 ')) {
      const targetGroup = text.split(' ')[1];
      if (!targetGroup) return true;
      const license = authManager.getGroupLicense(targetGroup);
      if (!license) {
        await pluginState.sendPrivateMsg(userId, `群 ${targetGroup} 未授权`);
      } else {
        const remaining = license.expireTime === -1 ? '永久' : Math.ceil((license.expireTime - Date.now()) / 86400000) + '天';
        await pluginState.sendPrivateMsg(userId, `群 ${targetGroup} (${license.level})\n剩余时间: ${remaining}`);
      }
      return true;
    }
    return false;
  }

  if (text === '查询授权' || text === '授权状态') {
    const license = authManager.getGroupLicense(groupId);
    if (!license) {
      await pluginState.sendGroupText(groupId, '⚠️ 本群当前未获得授权\n功能受限，请联系管理员获取授权。');
    } else {
      const remaining = license.expireTime === -1 ? '永久' : Math.ceil((license.expireTime - Date.now()) / 86400000) + '天';
      await pluginState.sendGroupText(groupId, `✅ 本群已授权 (${license.level === 'enterprise' ? '企业版' : '专业版'})\n📅 剩余有效期: ${remaining}`);
    }
    return true;
  }

  if (text.startsWith('激活 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const key = text.slice(3).trim();
    if (key.startsWith('PRO-30-')) {
      authManager.grantLicense(groupId, 30);
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, '激活成功！已获得 30 天专业版授权。');
    } else if (key.startsWith('PRO-PERM-')) {
      authManager.grantLicense(groupId, -1);
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, '激活成功！已获得 永久 专业版授权。');
    } else {
      await pluginState.sendGroupText(groupId, '无效的激活码');
    }
    return true;
  }

  return false;
}
