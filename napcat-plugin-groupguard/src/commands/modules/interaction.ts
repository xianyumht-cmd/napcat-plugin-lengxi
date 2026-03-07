import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../../state';
import { dbQuery } from '../../db';
import { authManager } from '../../auth';
import { getTarget, isAdminOrOwner, saveConfig } from '../common';

export const INTERACTION_PREFIXES = [
  '兑换 ',
  '开启发言奖励 ',
  '查封号',
  '查隐藏',
  '活跃统计'
];

export const INTERACTION_EXACT = [
  '签到',
  '签到榜',
  '我的积分',
  '抽奖',
  '邀请查询',
  '邀请榜',
  '关闭发言奖励'
];

export function matchInteractionCommand(text: string): string | null {
  if (INTERACTION_EXACT.includes(text)) return text;
  for (const p of INTERACTION_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleInteractionCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  if (event.message_type !== 'group') return false;
  if (!authManager.getGroupLicense(groupId)) return false;

  if (text === '签到') {
    if (pluginState.getGroupSettings(groupId).disableSignin) { await pluginState.sendGroupText(groupId, '本群签到功能已关闭'); return true; }
    let userSignin = await dbQuery.getSignin(groupId, userId);
    if (!userSignin) userSignin = { lastSignin: 0, days: 0, points: 0 };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (userSignin.lastSignin >= today) {
      await pluginState.sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ' 你今天已经签到过了，明天再来吧！' } }
      ]);
      return true;
    }
    const yesterday = today - 86400000;
    if (userSignin.lastSignin >= yesterday && userSignin.lastSignin < today) userSignin.days++;
    else userSignin.days = 1;
    const settings = pluginState.getGroupSettings(groupId);
    const min = settings.signinMin || 10;
    const max = settings.signinMax || 50;
    const base = Math.floor(Math.random() * (max - min + 1)) + min;
    const bonus = Math.min(userSignin.days, 10);
    const points = base + bonus;
    userSignin.points += points;
    userSignin.lastSignin = Date.now();
    await dbQuery.updateSignin(groupId, userId, userSignin);
    await pluginState.sendGroupMsg(groupId, [
      { type: 'at', data: { qq: userId } },
      { type: 'text', data: { text: ` 签到成功！\n获得积分：${points}\n当前积分：${userSignin.points}\n连续签到：${userSignin.days}天` } }
    ], { scene: 'signin_success', vars: { points, total: userSignin.points, days: userSignin.days } });
    return true;
  }
  if (text === '签到榜') {
    const data = await dbQuery.getAllSignin(groupId);
    if (!Object.keys(data).length) { await pluginState.sendGroupText(groupId, '本群暂无签到数据'); return true; }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const list = Object.entries(data).filter(([_, v]) => v.lastSignin >= today).sort((a, b) => b[1].lastSignin - a[1].lastSignin).slice(0, 10);
    if (!list.length) { await pluginState.sendGroupText(groupId, '今天还没有人签到哦'); return true; }
    const content = list.map((item, i) => `${i + 1}. ${item[0]} (${new Date(item[1].lastSignin).toLocaleTimeString()})`).join('\n');
    await pluginState.sendGroupText(groupId, `📅 今日签到榜\n${content}`);
    return true;
  }
  if (text === '我的积分') {
    const data = await dbQuery.getSignin(groupId, userId);
    await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 你的当前积分：${data ? data.points : 0}` } }]);
    return true;
  }
  if (text === '邀请查询') {
    const data = await dbQuery.getInvite(groupId, userId);
    await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 你已邀请 ${data ? data.inviteCount : 0} 人加入本群` } }]);
    return true;
  }
  if (text === '邀请榜') {
    const data = await dbQuery.getAllInvites(groupId);
    if (!Object.keys(data).length) { await pluginState.sendGroupText(groupId, '本群暂无邀请数据'); return true; }
    const list = Object.entries(data).sort((a, b) => b[1].inviteCount - a[1].inviteCount).slice(0, 10);
    await pluginState.sendGroupText(groupId, `🏆 邀请排行榜\n${list.map((item, i) => `${i + 1}. ${item[0]} - 邀请 ${item[1].inviteCount} 人`).join('\n')}`);
    return true;
  }
  if (text === '抽奖') {
    if (pluginState.getGroupSettings(groupId).disableLottery) { await pluginState.sendGroupText(groupId, '本群抽奖功能已关闭'); return true; }
    let userSignin = await dbQuery.getSignin(groupId, userId);
    const settings = pluginState.getGroupSettings(groupId);
    const cost = settings.lotteryCost || 20;
    const maxReward = settings.lotteryReward || 100;
    if (!userSignin || userSignin.points < cost) {
      await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 积分不足！抽奖需要${cost}积分，请先签到获取积分。` } }]);
      return true;
    }
    userSignin.points -= cost;
    const rand = Math.random();
    let prize = '';
    let bonus = 0;
    if (rand < 0.01) { prize = `特等奖：积分+${maxReward}`; bonus = maxReward; }
    else if (rand < 0.1) { prize = `一等奖：积分+${Math.floor(maxReward * 0.5)}`; bonus = Math.floor(maxReward * 0.5); }
    else if (rand < 0.3) { prize = `二等奖：积分+${Math.floor(maxReward * 0.3)}`; bonus = Math.floor(maxReward * 0.3); }
    else if (rand < 0.6) { prize = `三等奖：积分+${Math.floor(maxReward * 0.1)}`; bonus = Math.floor(maxReward * 0.1); }
    else { prize = '谢谢参与'; bonus = 0; }
    userSignin.points += bonus;
    await dbQuery.updateSignin(groupId, userId, userSignin);
    await pluginState.sendGroupMsg(groupId, [{ type: 'at', data: { qq: userId } }, { type: 'text', data: { text: ` 消耗${cost}积分抽奖...\n🎉 ${prize}\n当前积分：${userSignin.points}` } }]);
    return true;
  }
  if (text.startsWith('兑换 ')) {
    if (pluginState.getGroupSettings(groupId).disableLottery) return true;
    const args = text.slice(3).trim().split(/\s+/);
    const item = args[0];
    const param = args.slice(1).join(' ');
    let userSignin = await dbQuery.getSignin(groupId, userId);
    if (!userSignin) userSignin = { lastSignin: 0, days: 0, points: 0 };
    if (item === '免死金牌') {
      const cost = 100;
      if (userSignin.points < cost) { await pluginState.sendGroupText(groupId, `积分不足，需要 ${cost} 积分`); return true; }
      const warnings = await dbQuery.getWarning(groupId, userId);
      if (warnings <= 0) { await pluginState.sendGroupText(groupId, '你当前没有警告记录，无需使用免死金牌'); return true; }
      userSignin.points -= cost;
      await dbQuery.runInTransaction(() => { dbQuery.updateSignin(groupId, userId, userSignin); dbQuery.setWarning(groupId, userId, 0); });
      await pluginState.sendGroupText(groupId, `兑换成功！已清除所有警告记录。\n剩余积分：${userSignin.points}`);
      return true;
    }
    if (item === '头衔') {
      const cost = 500;
      if (userSignin.points < cost) { await pluginState.sendGroupText(groupId, `积分不足，需要 ${cost} 积分`); return true; }
      if (!param) { await pluginState.sendGroupText(groupId, '请指定头衔内容：兑换 头衔 <内容>'); return true; }
      if (!await pluginState.isBotAdmin(groupId)) { await pluginState.sendGroupText(groupId, '兑换失败：机器人非管理员，无法设置头衔'); return true; }
      userSignin.points -= cost;
      await dbQuery.updateSignin(groupId, userId, userSignin);
      await pluginState.callApi('set_group_special_title', { group_id: groupId, user_id: userId, special_title: param });
      await pluginState.sendGroupText(groupId, `兑换成功！头衔已设置为：${param}\n剩余积分：${userSignin.points}`);
      return true;
    }
    if (item === '解禁') {
      const cost = 200;
      const target = getTarget(raw, param) || userId;
      if (userSignin.points < cost) { await pluginState.sendGroupText(groupId, `积分不足，需要 ${cost} 积分`); return true; }
      if (!await pluginState.isBotAdmin(groupId)) { await pluginState.sendGroupText(groupId, '机器人非管理员'); return true; }
      userSignin.points -= cost;
      await dbQuery.updateSignin(groupId, userId, userSignin);
      await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: 0 });
      await pluginState.sendGroupText(groupId, `兑换成功！已解除 ${target} 的禁言。\n剩余积分：${userSignin.points}`);
      return true;
    }
    await pluginState.sendGroupText(groupId, '未知商品。请发送“积分商城”查看列表。');
    return true;
  }
  if (text === '积分商城' || text === '商城') {
    if (pluginState.getGroupSettings(groupId).disableLottery) { await pluginState.sendGroupText(groupId, '本群积分功能已关闭'); return true; }
    await pluginState.sendGroupText(groupId, `🛒 积分商城
----------------
1. 免死金牌 (清除警告) - 100积分
   指令：兑换 免死金牌
2. 自定义头衔 (永久) - 500积分
   指令：兑换 头衔 <内容>
3. 解除禁言 (自己) - 200积分
   指令：兑换 解禁
----------------
发送“我的积分”查看余额`);
    return true;
  }
  if (text.startsWith('开启发言奖励 ') || text === '关闭发言奖励') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (text === '关闭发言奖励') pluginState.config.groups[groupId].messageReward = 0;
    else {
      const points = parseInt(text.slice(7));
      if (isNaN(points) || points <= 0) { await pluginState.sendGroupText(groupId, '请输入正确的积分数'); return true; }
      pluginState.config.groups[groupId].messageReward = points;
    }
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, text === '关闭发言奖励' ? '已关闭发言奖励' : `已开启发言奖励，每条消息奖励 ${pluginState.config.groups[groupId].messageReward} 积分`);
    return true;
  }
  if (text.startsWith('活跃统计')) {
    if (pluginState.getGroupSettings(groupId).disableActivity) { await pluginState.sendGroupText(groupId, '本群活跃统计已关闭'); return true; }
    const stats = await dbQuery.getAllActivity(groupId);
    if (!Object.keys(stats).length) { await pluginState.sendGroupText(groupId, '本群暂无活跃统计数据'); return true; }
    const selfId = String((event as any).self_id || '');
    const entries = Object.entries(stats).sort((a, b) => b[1].msgCount - a[1].msgCount);
    const today = new Date().toISOString().slice(0, 10);
    const totalMsg = entries.reduce((s, [, r]) => s + r.msgCount, 0);
    const todayMsg = entries.reduce((s, [, r]) => s + (r.lastActiveDay === today ? r.msgCountToday : 0), 0);
    const summary = `📊 本群活跃统计\n总消息数：${totalMsg}\n今日消息：${todayMsg}\n统计人数：${entries.length}`;
    const pages: string[] = [];
    const pageSize = 15;
    for (let i = 0; i < entries.length; i += pageSize) {
      const chunk = entries.slice(i, i + pageSize);
      pages.push(`排行榜（${i + 1}-${i + chunk.length}）\n\n${chunk.map(([uid, r], idx) => `${i + idx + 1}. ${uid}\n   总消息：${r.msgCount} | 今日：${r.lastActiveDay === today ? r.msgCountToday : 0}\n   最后活跃：${new Date(r.lastActive).toLocaleString('zh-CN', { hour12: false })}`).join('\n\n')}`);
    }
    const nodes = [summary, ...pages].map(content => ({ type: 'node', data: { nickname: '📊 活跃统计', user_id: selfId, content: [{ type: 'text', data: { text: content } }] } }));
    await pluginState.callApi('send_group_forward_msg', { group_id: groupId, messages: nodes });
    return true;
  }
  return false;
}
