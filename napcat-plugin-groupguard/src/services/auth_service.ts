import { pluginState } from '../state';
import { authManager } from '../auth';
import { saveConfig, isAdminOrOwner, sendGroupScene, sendPrivateScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';

export async function executeAuthCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, ctx, text, userId, groupId } = input;
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
      await sendPrivateScene(userId, 'action_success', `已授权群 ${targetGroup} ${duration === '永久' ? '永久' : days + '天'}`, { target: targetGroup, days: duration === '永久' ? '永久' : days });
      return true;
    }
    if (text.startsWith('回收授权 ')) {
      const targetGroup = text.split(' ')[1];
      if (!targetGroup) return true;
      authManager.revokeLicense(targetGroup);
      saveConfig(ctx);
      await sendPrivateScene(userId, 'action_success', `已回收群 ${targetGroup} 授权`, { target: targetGroup });
      return true;
    }
    if (text.startsWith('查询授权 ')) {
      const targetGroup = text.split(' ')[1];
      if (!targetGroup) return true;
      const license = authManager.getGroupLicense(targetGroup);
      if (!license) {
        await sendPrivateScene(userId, 'not_found', `群 ${targetGroup} 未授权`, { target: targetGroup });
      } else {
        const remaining = license.expireTime === -1 ? '永久' : Math.ceil((license.expireTime - Date.now()) / 86400000) + '天';
        await sendPrivateScene(userId, 'raw_text', `群 ${targetGroup} (${license.level})\n剩余时间: ${remaining}`, { target: targetGroup });
      }
      return true;
    }
    return false;
  }

  if (text === '查询授权' || text === '授权状态' || text === '授权查询') {
    const license = authManager.getGroupLicense(groupId);
    if (!license) {
      await sendGroupScene(groupId, 'feature_disabled', '⚠️ 本群当前未获得授权\n功能受限，请联系管理员获取授权。');
    } else {
      const remaining = license.expireTime === -1 ? '永久' : Math.ceil((license.expireTime - Date.now()) / 86400000) + '天';
      await sendGroupScene(groupId, 'raw_text', `✅ 本群已授权 (${license.level === 'enterprise' ? '企业版' : '专业版'})\n📅 剩余有效期: ${remaining}`);
    }
    return true;
  }

  if (text.startsWith('激活 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const key = text.slice(3).trim();
    if (key.startsWith('PRO-30-')) {
      authManager.grantLicense(groupId, 30);
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', '激活成功！已获得 30 天专业版授权。');
    } else if (key.startsWith('PRO-PERM-')) {
      authManager.grantLicense(groupId, -1);
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', '激活成功！已获得 永久 专业版授权。');
    } else {
      await sendGroupScene(groupId, 'command_format_error', '无效的激活码', { example: '激活 PRO-30-xxxx 或 激活 PRO-PERM-xxxx' });
    }
    return true;
  }

  return false;
}
