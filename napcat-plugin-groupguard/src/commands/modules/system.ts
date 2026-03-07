import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../../state';
import { authManager } from '../../auth';
import { storageAdapter } from '../../storage_adapter';
import fs from 'fs';
import path from 'path';
import { saveConfig } from '../common';

export const SYSTEM_PREFIXES = [
  '多群广播 ',
  '定时任务 ',
  '删除定时任务 '
];

export const SYSTEM_EXACT = [
  '菜单',
  '帮助',
  '运行状态',
  '查看SQLite状态',
  '查看存储状态',
  '清空群配置',
  '确认清空群配置',
  '定时列表'
];

export function matchSystemCommand(text: string): string | null {
  if (SYSTEM_EXACT.includes(text)) return text;
  for (const p of SYSTEM_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleSystemCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');

  if (event.message_type === 'private') {
    if (text === '帮助' || text === '菜单') {
      const isOwner = pluginState.isOwner(userId);
      let menu = `🛡️ GroupGuard 私聊管理面板\n--------------------------\n`;
      if (isOwner) {
        menu += `📝 授权管理 (主人权限):\n` +
                `• 授权 <群号> <天数/永久> (默认专业版/企业版)\n` +
                `• 回收授权 <群号>\n` +
                `• 查询授权 <群号>\n\n` +
                `⚙️ 全局设置 (主人权限):\n` +
                `• 全局黑名单 <QQ> (跨群封禁)\n` +
                `• 全局白名单 <QQ> (豁免检测)\n` +
                `• 开启/关闭全局防撤回 (私聊接收撤回消息)\n`;
      } else {
        menu += `您当前仅有普通用户权限，无法执行管理指令。\n如需授权群组，请联系机器人主人。`;
      }
      menu += `\n--------------------------\n当前版本: ${pluginState.version}`;
      await pluginState.sendPrivateMsg(userId, menu);
      return true;
    }
    if (!pluginState.isOwner(userId)) {
      await pluginState.sendPrivateMsg(userId, '权限不足：该指令仅限机器人主人使用。');
      return true;
    }
    if (text === '查看SQLite状态' || text === '查看存储状态') {
      const status = storageAdapter.getStorageStatus();
      const tableLines = Object.entries(status.tableCounts).map(([k, v]) => `${k}: ${v}`).join('\n');
      await pluginState.sendPrivateMsg(
        userId,
        `SQLite 状态：\n迁移标记: ${status.migrated ? '已完成' : '未完成'}\n数据库: ${status.dbPath}\n表计数:\n${tableLines}`
      );
      return true;
    }
    if (text.startsWith('多群广播 ')) {
      const content = text.slice(5).trim();
      if (!content) { await pluginState.sendPrivateMsg(userId, '请输入广播内容'); return true; }
      await pluginState.sendPrivateMsg(userId, '开始广播，请稍候...');
      let groups: any[] = [];
      try {
        groups = await pluginState.callApi('get_group_list', {}) as any[] || [];
      } catch (e) {
        await pluginState.sendPrivateMsg(userId, `获取群列表失败: ${e}`);
        return true;
      }
      let success = 0;
      let fail = 0;
      for (const group of groups) {
        const gid = String(group.group_id);
        const license = authManager.getGroupLicense(gid);
        if (!license) continue;
        try {
          await pluginState.sendGroupText(gid, `【全员通知】\n${content}`);
          success++;
          await new Promise(r => setTimeout(r, 1500));
        } catch {
          fail++;
        }
      }
      await pluginState.sendPrivateMsg(userId, `广播完成。\n成功: ${success}\n失败: ${fail}`);
      return true;
    }
    return false;
  }

  if (text === '运行状态') {
    const uptime = Math.floor((Date.now() - pluginState.startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(2);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const cacheStats = `Msg: ${pluginState.msgCache.size} | Spam: ${pluginState.spamCache.size} | Admin: ${pluginState.adminCache.size}`;
    const status = `🤖 运行状态
⏱️ 运行时长：${h}小时${m}分${s}秒
📨 处理消息：${pluginState.msgCount} 条
💾 内存占用：RSS ${rss}MB / Heap ${heap}MB
📦 缓存对象：${cacheStats}
🛡️ 当前版本：v${pluginState.version}
👥 授权群数：${Object.keys(pluginState.config.licenses || {}).length}`;
    await pluginState.sendGroupText(groupId, status);
    return true;
  }
  if (text.startsWith('定时任务 ')) {
    const parts = text.split(/\s+/);
    if (parts.length < 3) { await pluginState.sendGroupText(groupId, '格式：定时任务 08:00 内容'); return true; }
    const time = parts[1];
    if (!/^\d{2}:\d{2}$/.test(time)) { await pluginState.sendGroupText(groupId, '时间格式错误，应为 HH:mm'); return true; }
    const content = parts.slice(2).join(' ');
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.scheduledTasks) gs.scheduledTasks = [];
    const id = Date.now().toString(36);
    gs.scheduledTasks.push({ id, cron: time, type: 'text', content });
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已添加定时任务 (ID:${id})：每天 ${time} 发送 "${content}"`);
    return true;
  }
  if (text.startsWith('删除定时任务 ')) {
    const id = text.slice(7).trim();
    if (!pluginState.config.groups[groupId]?.scheduledTasks) { await pluginState.sendGroupText(groupId, '本群无定时任务'); return true; }
    const gs = pluginState.config.groups[groupId];
    const before = gs.scheduledTasks!.length;
    gs.scheduledTasks = gs.scheduledTasks!.filter(t => t.id !== id);
    if (gs.scheduledTasks.length === before) await pluginState.sendGroupText(groupId, '未找到该ID的任务');
    else { saveConfig(ctx); await pluginState.sendGroupText(groupId, '已删除定时任务'); }
    return true;
  }
  if (text === '定时列表') {
    const tasks = pluginState.config.groups[groupId]?.scheduledTasks || [];
    if (!tasks.length) { await pluginState.sendGroupText(groupId, '本群无定时任务'); return true; }
    const list = tasks.map(t => `[${t.id}] ${t.cron} -> ${t.content}`).join('\n');
    await pluginState.sendGroupText(groupId, `定时任务列表：\n${list}`);
    return true;
  }
  if (text === '清空群配置') {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '此操作仅限机器人主人执行'); return true; }
    await pluginState.sendGroupText(groupId, '⚠️ 警告：此操作将清空本群所有配置和数据（包括问答、违禁词、日志等），且不可恢复！\n请发送「确认清空群配置」以执行。');
    return true;
  }
  if (text === '确认清空群配置') {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '此操作仅限机器人主人执行'); return true; }
    try {
      const groupDir = path.join(pluginState.configDir, 'data', 'groups', groupId);
      if (fs.existsSync(groupDir)) {
        fs.rmSync(groupDir, { recursive: true, force: true });
        fs.mkdirSync(groupDir, { recursive: true });
      }
      delete pluginState.config.groups[groupId];
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, '✅ 已清空本群所有配置和数据');
      pluginState.log('warn', `主人 ${userId} 清空了群 ${groupId} 的所有数据`);
    } catch (e) {
      await pluginState.sendGroupText(groupId, `清空失败: ${e}`);
    }
    return true;
  }
  return false;
}
