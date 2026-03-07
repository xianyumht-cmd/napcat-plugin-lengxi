import { pluginState } from '../state';
import { authManager } from '../auth';
import { storageAdapter } from '../storage_adapter';
import fs from 'fs';
import path from 'path';
import { isAdminOrOwner, saveConfig, sendGroupScene, sendPrivateScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';

export async function executeSystemCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, ctx } = input;
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
      await sendPrivateScene(userId, 'raw_text', menu);
      return true;
    }
    if (!pluginState.isOwner(userId)) {
      await sendPrivateScene(userId, 'permission_denied', '权限不足：该指令仅限机器人主人使用。');
      return true;
    }
    if (text === '查看SQLite状态' || text === '查看存储状态') {
      const status = storageAdapter.getStorageStatus();
      const tableLines = Object.entries(status.tableCounts).map(([k, v]) => `${k}: ${v}`).join('\n');
      await sendPrivateScene(
        userId,
        'raw_text',
        `SQLite 状态：\n迁移标记: ${status.migrated ? '已完成' : '未完成'}\n数据库: ${status.dbPath}\n表计数:\n${tableLines}`
      );
      return true;
    }
    if (text.startsWith('多群广播 ')) {
      const content = text.slice(5).trim();
      if (!content) { await sendPrivateScene(userId, 'command_format_error', '请输入广播内容', { example: '多群广播 今天20:00维护通知' }); return true; }
      await sendPrivateScene(userId, 'raw_text', '开始广播，请稍候...');
      let groups: any[] = [];
      try {
        groups = await pluginState.callApi('get_group_list', {}) as any[] || [];
      } catch (e) {
        await sendPrivateScene(userId, 'raw_text', `获取群列表失败: ${e}`);
        return true;
      }
      let success = 0;
      let fail = 0;
      for (const group of groups) {
        const gid = String(group.group_id);
        const license = authManager.getGroupLicense(gid);
        if (!license) continue;
        try {
          await sendGroupScene(gid, 'raw_text', `【全员通知】\n${content}`);
          success++;
          await new Promise(r => setTimeout(r, 1500));
        } catch {
          fail++;
        }
      }
      await sendPrivateScene(userId, 'raw_text', `广播完成。\n成功: ${success}\n失败: ${fail}`);
      return true;
    }
    return false;
  }

  if (text === '群管帮助' || text === '群管菜单') {
    await sendGroupScene(groupId, 'raw_text', '🛡️ 群管菜单\n发送“帮助”查看完整指令，发送“风控设置”查看风险相关指令。');
    return true;
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
    await sendGroupScene(groupId, 'raw_text', status);
    return true;
  }
  if (text.startsWith('定时任务 ')) {
    const parts = text.split(/\s+/);
    if (parts.length < 3) { await sendGroupScene(groupId, 'command_format_error', '格式：定时任务 08:00 内容', { example: '定时任务 08:00 早安' }); return true; }
    const time = parts[1];
    if (!/^\d{2}:\d{2}$/.test(time)) { await sendGroupScene(groupId, 'command_format_error', '时间格式错误，应为 HH:mm', { example: '08:00' }); return true; }
    const content = parts.slice(2).join(' ');
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.scheduledTasks) gs.scheduledTasks = [];
    const id = Date.now().toString(36);
    gs.scheduledTasks.push({ id, cron: time, type: 'text', content });
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已添加定时任务 (ID:${id})：每天 ${time} 发送 "${content}"`);
    return true;
  }
  if (text.startsWith('设置欢迎词 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const msg = text.slice(6).trim();
    if (!msg) { await sendGroupScene(groupId, 'command_format_error', '欢迎词不能为空', { example: '设置欢迎词 欢迎{user}加入{group}' }); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].welcomeMessage = msg;
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '欢迎词已更新');
    return true;
  }
  if (text.startsWith('删除定时任务 ')) {
    const id = text.slice(7).trim();
    if (!pluginState.config.groups[groupId]?.scheduledTasks) { await sendGroupScene(groupId, 'list_empty', '本群无定时任务'); return true; }
    const gs = pluginState.config.groups[groupId];
    const before = gs.scheduledTasks!.length;
    gs.scheduledTasks = gs.scheduledTasks!.filter(t => t.id !== id);
    if (gs.scheduledTasks.length === before) await sendGroupScene(groupId, 'not_found', '未找到该ID的任务');
    else { saveConfig(ctx); await sendGroupScene(groupId, 'action_success', '已删除定时任务'); }
    return true;
  }
  if (text === '定时列表') {
    const tasks = pluginState.config.groups[groupId]?.scheduledTasks || [];
    if (!tasks.length) { await sendGroupScene(groupId, 'list_empty', '本群无定时任务'); return true; }
    const list = tasks.map(t => `[${t.id}] ${t.cron} -> ${t.content}`).join('\n');
    await sendGroupScene(groupId, 'raw_text', `定时任务列表：\n${list}`);
    return true;
  }
  if (text === '清空群配置') {
    if (!pluginState.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '此操作仅限机器人主人执行'); return true; }
    await sendGroupScene(groupId, 'raw_text', '⚠️ 警告：此操作将清空本群所有配置和数据（包括问答、违禁词、日志等），且不可恢复！\n请发送「确认清空群配置」以执行。');
    return true;
  }
  if (text === '确认清空群配置') {
    if (!pluginState.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '此操作仅限机器人主人执行'); return true; }
    try {
      const groupDir = path.join(pluginState.configDir, 'data', 'groups', groupId);
      if (fs.existsSync(groupDir)) {
        fs.rmSync(groupDir, { recursive: true, force: true });
        fs.mkdirSync(groupDir, { recursive: true });
      }
      delete pluginState.config.groups[groupId];
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', '✅ 已清空本群所有配置和数据');
      pluginState.log('warn', `主人 ${userId} 清空了群 ${groupId} 的所有数据`);
    } catch (e) {
      await sendGroupScene(groupId, 'raw_text', `清空失败: ${e}`);
    }
    return true;
  }
  return false;
}
