import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../../state';
import { authManager } from '../../auth';
import { RISK_CONTROL_MENU } from '../../config';
import { isAdminOrOwner, saveConfig } from '../common';

export const RISK_PREFIXES = [
  '设置随机延迟 ',
  '设置发送队列模式 ',
  '设置发送并发 ',
  '设置全局限流 ',
  '设置问答冷却 ',
  '设置用户冷却 ',
  '设置分级冷却 ',
  '设置群熔断 ',
  '设置回复概率 ',
  '设置回复模板 ',
  '设置权限缓存 ',
  '开启宵禁 ',
  '设置复读阈值 ',
  '设置刷屏窗口 ',
  '设置刷屏阈值 ',
  '设置刷屏禁言 '
];

export const RISK_EXACT = [
  '查看发送策略',
  '开启调试',
  '关闭调试',
  '开启随机后缀',
  '关闭随机后缀',
  '开启全局自身撤回',
  '关闭全局自身撤回',
  '开启刷屏检测',
  '关闭刷屏检测',
  '风控设置',
  '安全设置'
];

export function matchRiskCommand(text: string): string | null {
  if (RISK_EXACT.includes(text)) return text;
  for (const p of RISK_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleRiskCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');

  if (event.message_type === 'private') {
    if (!pluginState.isOwner(userId)) return true;
    if (text === '开启调试') { pluginState.config.debug = true; saveConfig(ctx); await pluginState.sendPrivateMsg(userId, '调试模式已开启'); return true; }
    if (text === '关闭调试') { pluginState.config.debug = false; saveConfig(ctx); await pluginState.sendPrivateMsg(userId, '调试模式已关闭'); return true; }
    if (text === '开启随机后缀') { pluginState.config.global.randomSuffix = true; saveConfig(ctx); await pluginState.sendPrivateMsg(userId, '全局随机后缀已开启'); return true; }
    if (text === '关闭随机后缀') { pluginState.config.global.randomSuffix = false; saveConfig(ctx); await pluginState.sendPrivateMsg(userId, '全局随机后缀已关闭'); return true; }
    if (text === '开启全局自身撤回') { pluginState.config.global.autoRecallSelf = true; saveConfig(ctx); await pluginState.sendPrivateMsg(userId, '全局自身撤回已开启'); return true; }
    if (text === '关闭全局自身撤回') { pluginState.config.global.autoRecallSelf = false; saveConfig(ctx); await pluginState.sendPrivateMsg(userId, '全局自身撤回已关闭'); return true; }
    if (text.startsWith('设置随机延迟 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 3) { await pluginState.sendPrivateMsg(userId, '格式：设置随机延迟 <最小ms> <最大ms>'); return true; }
      const min = parseInt(parts[1]);
      const max = parseInt(parts[2]);
      if (isNaN(min) || isNaN(max)) { await pluginState.sendPrivateMsg(userId, '请输入有效的数字'); return true; }
      pluginState.config.global.randomDelayMin = min;
      pluginState.config.global.randomDelayMax = max;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `全局随机延迟已设置为 ${min}-${max}ms`);
      return true;
    }
    if (text.startsWith('设置发送队列模式 ')) {
      const mode = text.slice('设置发送队列模式 '.length).trim();
      if (mode !== '全局' && mode !== '分群') { await pluginState.sendPrivateMsg(userId, '格式：设置发送队列模式 全局/分群'); return true; }
      pluginState.config.global.queueMode = mode === '全局' ? 'global' : 'group';
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `发送队列模式已设置为：${mode}`);
      return true;
    }
    if (text.startsWith('设置发送并发 ')) {
      const n = parseInt(text.slice('设置发送并发 '.length).trim());
      if (isNaN(n) || n < 1 || n > 20) { await pluginState.sendPrivateMsg(userId, '并发范围：1-20'); return true; }
      pluginState.config.global.queueConcurrency = n;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `发送并发已设置为：${n}`);
      return true;
    }
    if (text.startsWith('设置全局限流 ')) {
      const n = parseInt(text.slice('设置全局限流 '.length).trim());
      if (isNaN(n) || n < 1) { await pluginState.sendPrivateMsg(userId, '请输入大于0的数字（单位：条/分钟）'); return true; }
      pluginState.config.global.globalMaxPerMinute = n;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `全局发送限流已设置为：${n}条/分钟`);
      return true;
    }
    if (text.startsWith('设置问答冷却 ')) {
      const n = parseInt(text.slice('设置问答冷却 '.length).trim());
      if (isNaN(n) || n < 0 || n > 3600) { await pluginState.sendPrivateMsg(userId, '冷却范围：0-3600 秒'); return true; }
      pluginState.config.global.qaCooldownSeconds = n;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `问答冷却已设置为：${n}秒`);
      return true;
    }
    if (text.startsWith('设置用户冷却 ')) {
      const n = parseInt(text.slice('设置用户冷却 '.length).trim());
      if (isNaN(n) || n < 0 || n > 3600) { await pluginState.sendPrivateMsg(userId, '冷却范围：0-3600 秒'); return true; }
      pluginState.config.global.qaUserCooldownSeconds = n;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `同用户冷却已设置为：${n}秒`);
      return true;
    }
    if (text.startsWith('设置分级冷却 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await pluginState.sendPrivateMsg(userId, '格式：设置分级冷却 <低> <中> <高>'); return true; }
      const low = parseInt(parts[1]);
      const medium = parseInt(parts[2]);
      const high = parseInt(parts[3]);
      if ([low, medium, high].some(n => isNaN(n) || n < 0 || n > 3600)) { await pluginState.sendPrivateMsg(userId, '范围：0-3600 秒'); return true; }
      pluginState.config.global.qaTierCooldownLow = low;
      pluginState.config.global.qaTierCooldownMedium = medium;
      pluginState.config.global.qaTierCooldownHigh = high;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `分级冷却已设置：低${low}s / 中${medium}s / 高${high}s`);
      return true;
    }
    if (text.startsWith('设置群熔断 ')) {
      const parts = text.split(/\s+/);
      if (parts.length < 4) { await pluginState.sendPrivateMsg(userId, '格式：设置群熔断 <窗口秒> <阈值> <熔断秒>'); return true; }
      const windowSec = parseInt(parts[1]);
      const threshold = parseInt(parts[2]);
      const cooldownSec = parseInt(parts[3]);
      if ([windowSec, threshold, cooldownSec].some(n => isNaN(n) || n <= 0)) { await pluginState.sendPrivateMsg(userId, '请输入大于0的整数'); return true; }
      pluginState.config.global.groupFuseWindowSeconds = windowSec;
      pluginState.config.global.groupFuseThreshold = threshold;
      pluginState.config.global.groupFuseCooldownSeconds = cooldownSec;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `群熔断已设置：窗口${windowSec}s 阈值${threshold} 熔断${cooldownSec}s`);
      return true;
    }
    if (text.startsWith('设置回复概率 ')) {
      const n = parseInt(text.slice('设置回复概率 '.length).trim());
      if (isNaN(n) || n < 0 || n > 100) { await pluginState.sendPrivateMsg(userId, '概率范围：0-100'); return true; }
      pluginState.config.global.replyProbability = n;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `回复概率已设置为：${n}%`);
      return true;
    }
    if (text.startsWith('设置回复模板 ')) {
      const rawTpl = text.slice('设置回复模板 '.length).trim();
      const arr = rawTpl.split('|').map(s => s.trim()).filter(Boolean);
      if (!arr.length) { await pluginState.sendPrivateMsg(userId, '格式：设置回复模板 模板1|模板2（模板需包含 {msg}）'); return true; }
      const valid = arr.filter(s => s.includes('{msg}'));
      if (!valid.length) { await pluginState.sendPrivateMsg(userId, '模板必须包含 {msg} 占位符'); return true; }
      pluginState.config.global.replyTemplatePool = valid;
      saveConfig(ctx);
      await pluginState.sendPrivateMsg(userId, `回复模板已更新，共${valid.length}条`);
      return true;
    }
    if (text === '查看发送策略') {
      const g = pluginState.config.global;
      await pluginState.sendPrivateMsg(
        userId,
        `发送策略：\n队列模式: ${g.queueMode === 'global' ? '全局' : '分群'}\n发送并发: ${g.queueConcurrency || 1}\n全局限流: ${(g.globalMaxPerMinute || 180)}条/分钟\n问答冷却: ${(g.qaCooldownSeconds ?? 30)}秒\n同用户冷却: ${(g.qaUserCooldownSeconds ?? 12)}秒\n分级冷却: 低${g.qaTierCooldownLow ?? 15}/中${g.qaTierCooldownMedium ?? 30}/高${g.qaTierCooldownHigh ?? 60}\n群熔断: 窗口${g.groupFuseWindowSeconds ?? 60}s 阈值${g.groupFuseThreshold ?? 45} 熔断${g.groupFuseCooldownSeconds ?? 90}s\n回复概率: ${(g.replyProbability ?? 100)}%\n模板池: ${(g.replyTemplatePool || ['{msg}']).join(' | ')}`
      );
      return true;
    }
    return false;
  }

  if (!authManager.getGroupLicense(groupId)) return false;
  if (text === '风控设置' || text === '安全设置') {
    const selfId = String((event as any).self_id || '');
    const nodes = [
      { type: 'node', data: { nickname: '🛡️ 风控配置', user_id: selfId, content: [{ type: 'text', data: { text: RISK_CONTROL_MENU } }] } }
    ];
    await pluginState.callApi('send_group_forward_msg', { group_id: groupId, messages: nodes });
    return true;
  }
  if (text.startsWith('设置权限缓存 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const seconds = parseInt(text.slice(7));
    if (isNaN(seconds) || seconds < 0) { await pluginState.sendGroupText(groupId, '请输入有效的秒数 (0=关闭)'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].adminCacheSeconds = seconds;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已设置管理员权限缓存时间为 ${seconds} 秒`);
    return true;
  }
  if (text.startsWith('开启宵禁 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const parts = text.split(/\s+/);
    if (parts.length < 3) { await pluginState.sendGroupText(groupId, '格式：开启宵禁 00:00 06:00'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    gs.enableCurfew = true;
    gs.curfewStart = parts[1];
    gs.curfewEnd = parts[2];
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已开启宵禁：每天 ${gs.curfewStart} 至 ${gs.curfewEnd} 全员禁言`);
    return true;
  }
  if (text === '开启刷屏检测' || text === '关闭刷屏检测') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].spamDetect = text === '开启刷屏检测';
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, text === '开启刷屏检测' ? '已开启刷屏检测' : '已关闭刷屏检测');
    return true;
  }
  if (text.startsWith('设置复读阈值 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const val = parseInt(text.slice(7).trim());
    if (isNaN(val) || val < 0) { await pluginState.sendGroupText(groupId, '请输入有效的数字 (0表示关闭)'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].repeatThreshold = val;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已设置复读阈值: ${val} (连续${val}条相同内容触发检测)`);
    return true;
  }
  if (text.startsWith('设置刷屏窗口 ') || text.startsWith('设置刷屏阈值 ') || text.startsWith('设置刷屏禁言 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const v = parseInt(text.slice(7).trim());
    if (isNaN(v) || v < 1) { await pluginState.sendGroupText(groupId, '请输入有效数字（至少1）'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (text.startsWith('设置刷屏窗口 ')) pluginState.config.groups[groupId].spamWindow = v;
    else if (text.startsWith('设置刷屏阈值 ')) pluginState.config.groups[groupId].spamThreshold = v;
    else pluginState.config.groups[groupId].spamBanMinutes = v;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '刷屏参数已更新');
    return true;
  }
  if (text === '开启入群验证' || text === '关闭入群验证' || text === '开启自动审批' || text === '关闭自动审批' || text === '开启退群拉黑' || text === '关闭退群拉黑') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (text === '开启入群验证') gs.enableVerify = true;
    if (text === '关闭入群验证') gs.enableVerify = false;
    if (text === '开启自动审批') gs.autoApprove = true;
    if (text === '关闭自动审批') gs.autoApprove = false;
    if (text === '开启退群拉黑') gs.leaveBlacklist = true;
    if (text === '关闭退群拉黑') gs.leaveBlacklist = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '设置已更新');
    return true;
  }
  if (text.startsWith('设置入群暗号 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const passphrase = text.slice(7).trim();
    if (!passphrase) { await pluginState.sendGroupText(groupId, '暗号不能为空'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].entryPassphrase = passphrase;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已设置入群暗号为：「${passphrase}」`);
    return true;
  }
  if (text === '关闭入群暗号' || text === '开启暗号回落' || text === '关闭暗号回落') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (text === '关闭入群暗号') pluginState.config.groups[groupId].entryPassphrase = '';
    if (text === '开启暗号回落') pluginState.config.groups[groupId].enableAutoApproveAfterPassphraseOff = true;
    if (text === '关闭暗号回落') pluginState.config.groups[groupId].enableAutoApproveAfterPassphraseOff = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '设置已更新');
    return true;
  }
  if (text.startsWith('开启功能 ') || text.startsWith('关闭功能 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const isEnable = text.startsWith('开启功能 ');
    const feature = text.slice(5).trim();
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    switch (feature) {
      case '问答': gs.disableQA = !isEnable; break;
      case '签到': gs.disableSignin = !isEnable; break;
      case '抽奖': gs.disableLottery = !isEnable; break;
      case '邀请统计': gs.disableInvite = !isEnable; break;
      case '活跃统计': gs.disableActivity = !isEnable; break;
      case '自动同意': gs.autoApprove = isEnable; break;
      case '入群验证': gs.enableVerify = isEnable; break;
      case '刷屏检测': gs.spamDetect = isEnable; break;
      case '退群拉黑': gs.leaveBlacklist = isEnable; break;
      case '暗号回落': gs.enableAutoApproveAfterPassphraseOff = isEnable; break;
      default:
        await pluginState.sendGroupText(groupId, '未知功能。支持：问答、签到、抽奖、邀请统计、活跃统计、自动同意、入群验证、刷屏检测、退群拉黑、暗号回落');
        return true;
    }
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已${isEnable ? '开启' : '关闭'}功能：${feature}`);
    return true;
  }
  if (text.startsWith('屏蔽 ') || text.startsWith('取消屏蔽 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const isBlock = text.startsWith('屏蔽 ');
    const type = text.slice(isBlock ? 3 : 5).trim();
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.msgFilter) gs.msgFilter = { ...pluginState.config.global.msgFilter };
    switch (type) {
      case '图片': gs.msgFilter.blockImage = isBlock; break;
      case '视频': gs.msgFilter.blockVideo = isBlock; break;
      case '语音': gs.msgFilter.blockRecord = isBlock; break;
      case '链接': gs.msgFilter.blockUrl = isBlock; break;
      case '二维码': gs.msgFilter.blockQr = isBlock; break;
      case '名片': gs.msgFilter.blockContact = isBlock; break;
      case '小程序': gs.msgFilter.blockLightApp = isBlock; break;
      case '转发': gs.msgFilter.blockForward = isBlock; break;
      default: await pluginState.sendGroupText(groupId, '未知类型。支持：图片、视频、语音、链接、二维码、名片、小程序、转发'); return true;
    }
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已${isBlock ? '屏蔽' : '取消屏蔽'}：${type}`);
    return true;
  }
  if (text === '开启二维码撤回' || text === '关闭二维码撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (!pluginState.config.groups[groupId].msgFilter) pluginState.config.groups[groupId].msgFilter = { ...pluginState.config.global.msgFilter };
    pluginState.config.groups[groupId].msgFilter!.blockQr = text === '开启二维码撤回';
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, text === '开启二维码撤回' ? '已开启二维码撤回' : '已关闭二维码撤回');
    return true;
  }
  return false;
}
