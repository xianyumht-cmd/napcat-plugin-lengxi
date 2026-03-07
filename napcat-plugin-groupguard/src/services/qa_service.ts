import { pluginState } from '../state';
import { authManager } from '../auth';
import { isAdminOrOwner, saveConfig, sendGroupScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';

export async function executeQaCommand(input: CommandExecutionContext): Promise<boolean> {
  const { event, text, userId, groupId, ctx } = input;
  if (event.message_type !== 'group') return false;
  if (!authManager.getGroupLicense(groupId)) return false;

  if (text.startsWith('添加违禁词') || text.startsWith('添加全局违禁词') || text.startsWith('删除违禁词') || text.startsWith('删除全局违禁词') || text.startsWith('设置违禁词惩罚 ') || text.startsWith('设置违禁词禁言 ') || text === '违禁词列表') {
    if (text === '违禁词列表') {
      const settings = pluginState.getGroupSettings(groupId);
      const groupKw = settings.filterKeywords || [];
      const globalKw = pluginState.config.filterKeywords || [];
      let msg = '🚫 违禁词列表\n';
      if (groupKw.length) msg += `【本群】：${groupKw.join('、')}\n`;
      if (globalKw.length) msg += `【全局】：${globalKw.join('、')}`;
      if (!groupKw.length && !globalKw.length) msg += '暂无违禁词';
      await sendGroupScene(groupId, !groupKw.length && !globalKw.length ? 'list_empty' : 'raw_text', msg);
      return true;
    }
    const ownerOnly = text.startsWith('添加全局违禁词') || text.startsWith('删除全局违禁词');
    if (ownerOnly && !pluginState.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '需要主人权限'); return true; }
    if (!ownerOnly && !await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (text.startsWith('设置违禁词惩罚 ')) {
      const level = parseInt(text.slice(8).trim());
      if (isNaN(level) || level < 1 || level > 4) { await sendGroupScene(groupId, 'invalid_range', '请输入有效的惩罚等级 (1-4)：\n1: 仅撤回\n2: 撤回+禁言\n3: 撤回+踢出\n4: 撤回+踢出+拉黑', { example: '设置违禁词惩罚 2' }); return true; }
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      pluginState.config.groups[groupId].filterPunishLevel = level;
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已设置违禁词惩罚等级为：${level}`, { level });
      return true;
    }
    if (text.startsWith('设置违禁词禁言 ')) {
      const minutes = parseInt(text.slice(8).trim());
      if (isNaN(minutes) || minutes < 1) { await sendGroupScene(groupId, 'invalid_range', '请输入有效的禁言时长（分钟）', { example: '设置违禁词禁言 10' }); return true; }
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      pluginState.config.groups[groupId].filterBanMinutes = minutes;
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已设置违禁词禁言时长为：${minutes} 分钟`, { minutes });
      return true;
    }
    const add = text.startsWith('添加');
    const global = text.includes('全局');
    const word = text.slice(global ? 7 : 5).trim();
    if (!word) { await sendGroupScene(groupId, 'command_format_error', '请指定违禁词', { example: '添加违禁词 广告' }); return true; }
    if (global) {
      pluginState.config.filterKeywords = pluginState.config.filterKeywords || [];
      if (add) { if (!pluginState.config.filterKeywords.includes(word)) pluginState.config.filterKeywords.push(word); }
      else pluginState.config.filterKeywords = pluginState.config.filterKeywords.filter(w => w !== word);
    } else {
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      const gs = pluginState.config.groups[groupId];
      gs.filterKeywords = gs.filterKeywords || [];
      if (add) { if (!gs.filterKeywords.includes(word)) gs.filterKeywords.push(word); }
      else gs.filterKeywords = gs.filterKeywords.filter(w => w !== word);
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', add ? `已添加：${word}` : `已移除：${word}`, { target: word });
    return true;
  }

  if (text.startsWith('添加拒绝词') || text.startsWith('添加全局拒绝词') || text.startsWith('删除拒绝词') || text.startsWith('删除全局拒绝词') || text === '拒绝词列表') {
    if (text === '拒绝词列表') {
      const settings = pluginState.getGroupSettings(groupId);
      const groupKw = settings.rejectKeywords || [];
      const globalKw = pluginState.config.rejectKeywords || [];
      let msg = '🚫 入群拒绝词列表\n';
      if (groupKw.length) msg += `【本群】：${groupKw.join('、')}\n`;
      if (globalKw.length) msg += `【全局】：${globalKw.join('、')}`;
      if (!groupKw.length && !globalKw.length) msg += '暂无拒绝词';
      await sendGroupScene(groupId, !groupKw.length && !globalKw.length ? 'list_empty' : 'raw_text', msg);
      return true;
    }
    const ownerOnly = text.startsWith('添加全局拒绝词') || text.startsWith('删除全局拒绝词');
    if (ownerOnly && !pluginState.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '需要主人权限'); return true; }
    if (!ownerOnly && !await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const add = text.startsWith('添加');
    const global = text.includes('全局');
    const word = text.slice(global ? 7 : 5).trim();
    if (!word) { await sendGroupScene(groupId, 'command_format_error', '请指定关键词', { example: '添加拒绝词 引流' }); return true; }
    if (global) {
      pluginState.config.rejectKeywords = pluginState.config.rejectKeywords || [];
      if (add) { if (!pluginState.config.rejectKeywords.includes(word)) pluginState.config.rejectKeywords.push(word); }
      else pluginState.config.rejectKeywords = pluginState.config.rejectKeywords.filter(w => w !== word);
    } else {
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      const gs = pluginState.config.groups[groupId];
      gs.rejectKeywords = gs.rejectKeywords || [];
      if (add) { if (!gs.rejectKeywords.includes(word)) gs.rejectKeywords.push(word); }
      else gs.rejectKeywords = gs.rejectKeywords.filter(w => w !== word);
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', add ? `已添加：${word}` : `已移除：${word}`, { target: word });
    return true;
  }

  if (text === '问答列表') {
    const settings = pluginState.getGroupSettings(groupId);
    const groupQa = settings.qaList || [];
    const globalQa = pluginState.config.qaList || [];
    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    const list = isGroupCustom ? groupQa : globalQa;
    const label = isGroupCustom ? '本群' : '全局';
    if (!list.length) { await sendGroupScene(groupId, 'list_empty', `${label}问答列表为空`); return true; }
    const modeMap: Record<string, string> = { exact: '精确', contains: '模糊', regex: '正则' };
    await sendGroupScene(groupId, 'raw_text', `${label}问答列表：\n${list.map((q, i) => `${i + 1}. [${modeMap[q.mode] || q.mode}] ${q.keyword} → ${q.reply}`).join('\n')}`);
    return true;
  }
  if (text.startsWith('模糊问') || text.startsWith('精确问') || text.startsWith('添加正则问答 ') || text.startsWith('删除问答 ') || text.startsWith('删问') || text.startsWith('添加问答 ') || text.startsWith('添加模糊问答 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (text.startsWith('添加问答 ') || text.startsWith('添加模糊问答 ')) { await sendGroupScene(groupId, 'not_found', '指令已更新，请使用：精确问XX答YY / 模糊问XX答YY'); return true; }
    if (text.startsWith('删除问答 ') || text.startsWith('删问')) {
      const prefix = text.startsWith('删问') ? '删问' : '删除问答 ';
      const keyword = text.slice(prefix.length).trim();
      if (!keyword) { await sendGroupScene(groupId, 'command_format_error', '请指定关键词', { example: '删问 你好' }); return true; }
      const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
      if (!isGroupCustom) { await sendGroupScene(groupId, 'feature_disabled', '当前为全局配置模式，无法删除全局问答。请先开启分群独立配置。'); return true; }
      const gs = pluginState.config.groups[groupId];
      if (!gs.qaList) { await sendGroupScene(groupId, 'list_empty', '未找到相关问答'); return true; }
      const before = gs.qaList.length;
      gs.qaList = gs.qaList.filter(q => q.keyword !== keyword);
      if (gs.qaList.length === before) await sendGroupScene(groupId, 'not_found', `未找到问答：${keyword}`, { target: keyword });
      else { saveConfig(ctx); await sendGroupScene(groupId, 'action_success', `已删除问答：${keyword}`, { target: keyword }); }
      return true;
    }
    if (text.startsWith('添加正则问答 ')) {
      const rest = text.slice(7).trim();
      const sep = rest.indexOf('|');
      if (sep < 1) { await sendGroupScene(groupId, 'command_format_error', '格式：添加正则问答 表达式|回复', { example: '添加正则问答 ^你好$|你好呀' }); return true; }
      const keyword = rest.slice(0, sep).trim();
      const reply = rest.slice(sep + 1).trim();
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId), useGlobal: false, qaList: [] };
      if (!pluginState.config.groups[groupId].qaList) pluginState.config.groups[groupId].qaList = [];
      pluginState.config.groups[groupId].qaList!.push({ keyword, reply, mode: 'regex' });
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已添加正则问答：${keyword} → ${reply}`, { target: keyword });
      return true;
    }
    let mode = 'contains';
    let rest = '';
    if (text.startsWith('模糊问')) { mode = 'contains'; rest = text.slice(3); } else { mode = 'exact'; rest = text.slice(3); }
    const sep = rest.indexOf('答');
    if (sep < 1) { await sendGroupScene(groupId, 'command_format_error', '格式错误，示例：模糊问你好答在的 | 精确问帮助答请看菜单', { example: '精确问帮助答请看菜单' }); return true; }
    const keyword = rest.slice(0, sep).trim();
    const reply = rest.slice(sep + 1).trim();
    if (!keyword || !reply) { await sendGroupScene(groupId, 'command_format_error', '关键词和回复不能为空', { example: '模糊问你好答你好呀' }); return true; }
    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    if (isGroupCustom) {
      const gs = pluginState.config.groups[groupId];
      if (!gs.qaList) gs.qaList = [];
      gs.qaList.push({ keyword, reply, mode: mode as any });
    } else {
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId), useGlobal: false, qaList: [] };
      if (!pluginState.config.groups[groupId].qaList) pluginState.config.groups[groupId].qaList = [];
      pluginState.config.groups[groupId].qaList!.push({ keyword, reply, mode: mode as any });
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', `已添加${mode === 'exact' ? '精确' : '模糊'}问答：${keyword} → ${reply}`, { target: keyword });
    return true;
  }

  return false;
}
