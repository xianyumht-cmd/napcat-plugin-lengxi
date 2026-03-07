import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../../state';
import { authManager } from '../../auth';
import { isAdminOrOwner, saveConfig } from '../common';

export const QA_PREFIXES = [
  '添加问答 ',
  '添加模糊问答 ',
  '添加正则问答 ',
  '删除问答 ',
  '删问',
  '模糊问',
  '精确问',
  '添加拒绝词',
  '添加全局拒绝词',
  '删除拒绝词',
  '删除全局拒绝词',
  '添加违禁词',
  '添加全局违禁词',
  '删除违禁词',
  '删除全局违禁词',
  '设置违禁词惩罚 ',
  '设置违禁词禁言 '
];

export const QA_EXACT = [
  '问答列表',
  '拒绝词列表',
  '违禁词列表'
];

export function matchQaCommand(text: string): string | null {
  if (QA_EXACT.includes(text)) return text;
  for (const p of QA_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleQaCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
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
      await pluginState.sendGroupText(groupId, msg);
      return true;
    }
    const ownerOnly = text.startsWith('添加全局违禁词') || text.startsWith('删除全局违禁词');
    if (ownerOnly && !pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    if (!ownerOnly && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (text.startsWith('设置违禁词惩罚 ')) {
      const level = parseInt(text.slice(8).trim());
      if (isNaN(level) || level < 1 || level > 4) { await pluginState.sendGroupText(groupId, '请输入有效的惩罚等级 (1-4)：\n1: 仅撤回\n2: 撤回+禁言\n3: 撤回+踢出\n4: 撤回+踢出+拉黑'); return true; }
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      pluginState.config.groups[groupId].filterPunishLevel = level;
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, `已设置违禁词惩罚等级为：${level}`);
      return true;
    }
    if (text.startsWith('设置违禁词禁言 ')) {
      const minutes = parseInt(text.slice(8).trim());
      if (isNaN(minutes) || minutes < 1) { await pluginState.sendGroupText(groupId, '请输入有效的禁言时长（分钟）'); return true; }
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      pluginState.config.groups[groupId].filterBanMinutes = minutes;
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, `已设置违禁词禁言时长为：${minutes} 分钟`);
      return true;
    }
    const add = text.startsWith('添加');
    const global = text.includes('全局');
    const word = text.slice(global ? 7 : 5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词'); return true; }
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
    await pluginState.sendGroupText(groupId, add ? `已添加：${word}` : `已移除：${word}`);
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
      await pluginState.sendGroupText(groupId, msg);
      return true;
    }
    const ownerOnly = text.startsWith('添加全局拒绝词') || text.startsWith('删除全局拒绝词');
    if (ownerOnly && !pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    if (!ownerOnly && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const add = text.startsWith('添加');
    const global = text.includes('全局');
    const word = text.slice(global ? 7 : 5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }
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
    await pluginState.sendGroupText(groupId, add ? `已添加：${word}` : `已移除：${word}`);
    return true;
  }

  if (text === '问答列表') {
    const settings = pluginState.getGroupSettings(groupId);
    const groupQa = settings.qaList || [];
    const globalQa = pluginState.config.qaList || [];
    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    const list = isGroupCustom ? groupQa : globalQa;
    const label = isGroupCustom ? '本群' : '全局';
    if (!list.length) { await pluginState.sendGroupText(groupId, `${label}问答列表为空`); return true; }
    const modeMap: Record<string, string> = { exact: '精确', contains: '模糊', regex: '正则' };
    await pluginState.sendGroupText(groupId, `${label}问答列表：\n${list.map((q, i) => `${i + 1}. [${modeMap[q.mode] || q.mode}] ${q.keyword} → ${q.reply}`).join('\n')}`);
    return true;
  }
  if (text.startsWith('模糊问') || text.startsWith('精确问') || text.startsWith('添加正则问答 ') || text.startsWith('删除问答 ') || text.startsWith('删问') || text.startsWith('添加问答 ') || text.startsWith('添加模糊问答 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (text.startsWith('添加问答 ') || text.startsWith('添加模糊问答 ')) { await pluginState.sendGroupText(groupId, '指令已更新，请使用：精确问XX答YY / 模糊问XX答YY'); return true; }
    if (text.startsWith('删除问答 ') || text.startsWith('删问')) {
      const prefix = text.startsWith('删问') ? '删问' : '删除问答 ';
      const keyword = text.slice(prefix.length).trim();
      if (!keyword) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }
      const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
      if (!isGroupCustom) { await pluginState.sendGroupText(groupId, '当前为全局配置模式，无法删除全局问答。请先开启分群独立配置。'); return true; }
      const gs = pluginState.config.groups[groupId];
      if (!gs.qaList) { await pluginState.sendGroupText(groupId, '未找到相关问答'); return true; }
      const before = gs.qaList.length;
      gs.qaList = gs.qaList.filter(q => q.keyword !== keyword);
      if (gs.qaList.length === before) await pluginState.sendGroupText(groupId, `未找到问答：${keyword}`);
      else { saveConfig(ctx); await pluginState.sendGroupText(groupId, `已删除问答：${keyword}`); }
      return true;
    }
    if (text.startsWith('添加正则问答 ')) {
      const rest = text.slice(7).trim();
      const sep = rest.indexOf('|');
      if (sep < 1) { await pluginState.sendGroupText(groupId, '格式：添加正则问答 表达式|回复'); return true; }
      const keyword = rest.slice(0, sep).trim();
      const reply = rest.slice(sep + 1).trim();
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId), useGlobal: false, qaList: [] };
      if (!pluginState.config.groups[groupId].qaList) pluginState.config.groups[groupId].qaList = [];
      pluginState.config.groups[groupId].qaList!.push({ keyword, reply, mode: 'regex' });
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, `已添加正则问答：${keyword} → ${reply}`);
      return true;
    }
    let mode = 'contains';
    let rest = '';
    if (text.startsWith('模糊问')) { mode = 'contains'; rest = text.slice(3); } else { mode = 'exact'; rest = text.slice(3); }
    const sep = rest.indexOf('答');
    if (sep < 1) { await pluginState.sendGroupText(groupId, '格式错误，示例：模糊问你好答在的 | 精确问帮助答请看菜单'); return true; }
    const keyword = rest.slice(0, sep).trim();
    const reply = rest.slice(sep + 1).trim();
    if (!keyword || !reply) { await pluginState.sendGroupText(groupId, '关键词和回复不能为空'); return true; }
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
    await pluginState.sendGroupText(groupId, `已添加${mode === 'exact' ? '精确' : '模糊'}问答：${keyword} → ${reply}`);
    return true;
  }

  return false;
}
