import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from '../state';
import { detectQrCode } from '../qr';
import { saveConfig } from '../commands/common';
import { groupguardRepository } from '../repositories/groupguard_repository';

export async function executeHandleAntiRecall(groupId: string, messageId: string, operatorId: string): Promise<void> {
  if (operatorId === pluginState.botId) return;
  if (!pluginState.config.antiRecallGroups.includes(groupId) && !pluginState.config.globalAntiRecall) return;
  const cached = pluginState.msgCache.get(messageId);
  if (!cached) return;
  const contentSegments = cached.segments.length ? cached.segments : [{ type: 'text', data: { text: cached.raw } }];
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const owners = pluginState.config.ownerQQs.split(',').map(s => s.trim()).filter(Boolean);
  for (const owner of owners) {
    await pluginState.callApi('send_private_msg', {
      user_id: owner,
      message: [
        { type: 'text', data: { text: `🔔 防撤回通知\n群号：${groupId}\nQQ号：${cached.userId}\n时间：${timeStr}\n撤回内容：\n` } },
        ...contentSegments
      ]
    });
  }
}

export function executeCacheMessage(messageId: string, userId: string, groupId: string, raw: string, segments?: any[]): void {
  if (!pluginState.config.antiRecallGroups.includes(groupId) && !pluginState.config.globalAntiRecall) return;
  pluginState.msgCache.set(messageId, { userId, groupId, raw, segments: segments || [], time: Date.now() });
  const now = Date.now();
  for (const [k, v] of pluginState.msgCache) {
    if (now - v.time > 600000) pluginState.msgCache.delete(k);
  }
}

export async function executeHandleEmojiReact(groupId: string, userId: string, messageId: string, selfId: string): Promise<void> {
  if (pluginState.config.globalEmojiReact) {
    await pluginState.callApi('set_msg_emoji_like', { message_id: messageId, emoji_id: '76' });
    return;
  }
  const targets = pluginState.config.emojiReactGroups[groupId];
  if (!targets || !targets.length) return;
  const shouldReact = targets.includes(userId) || (targets.includes('self') && userId === selfId);
  if (!shouldReact) return;
  await pluginState.callApi('set_msg_emoji_like', { message_id: messageId, emoji_id: '76' });
}

export async function executeHandleCardLockCheck(groupId: string, userId: string): Promise<void> {
  const key = `${groupId}:${userId}`;
  const lockedCard = pluginState.config.cardLocks[key];
  if (lockedCard === undefined) return;
  const info = await pluginState.callApi('get_group_member_info', { group_id: groupId, user_id: userId, no_cache: true }) as any;
  const currentCard = info?.card || '';
  if (currentCard !== lockedCard) {
    await pluginState.callApi('set_group_card', { group_id: groupId, user_id: userId, card: lockedCard });
    pluginState.debug(`名片锁定: ${userId} 在群 ${groupId} 名片被还原为 ${lockedCard}`);
  }
}

export async function executeHandleCardLockOnMessage(groupId: string, userId: string, senderCard: string): Promise<void> {
  const key = `${groupId}:${userId}`;
  const lockedCard = pluginState.config.cardLocks[key];
  if (lockedCard === undefined) return;
  const currentCard = senderCard || '';
  if (currentCard !== lockedCard) {
    pluginState.log('info', `[MsgCheck] 监测到 ${userId} 名片异常(当前: "${currentCard}", 锁定: "${lockedCard}")，正在修正...`);
    await pluginState.callApi('set_group_card', { group_id: groupId, user_id: userId, card: lockedCard });
  }
}

export async function executeHandleAutoRecall(groupId: string, userId: string, messageId: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const targets = settings.targetUsers || [];
  if (!targets.includes(userId)) return false;
  await pluginState.callApi('delete_msg', { message_id: messageId });
  pluginState.debug(`针对撤回: 群 ${groupId} 用户 ${userId} 消息 ${messageId}`);
  return true;
}

export async function executeSendWelcomeMessage(groupId: string, userId: string): Promise<void> {
  const settings = pluginState.getGroupSettings(groupId);
  const tpl = (settings.welcomeMessage !== undefined && settings.welcomeMessage !== '') ? settings.welcomeMessage : (pluginState.config.welcomeMessage || '');
  if (!tpl) return;
  const msg = tpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
  await pluginState.sendGroupMsg(groupId, [
    { type: 'at', data: { qq: userId } },
    { type: 'text', data: { text: ` ${msg}` } }
  ]);
}

export async function executeHandleMsgTypeFilter(groupId: string, userId: string, messageId: string, raw: string, messageSegments: any[]): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const filter = settings.msgFilter || pluginState.config.msgFilter;
  if (!filter) return false;
  const types = (messageSegments || []).map((s: any) => s.type);
  let blocked = false;
  let reason = '';
  if (filter.blockVideo && types.includes('video')) { blocked = true; reason = '视频'; }
  else if (filter.blockImage && types.includes('image')) { blocked = true; reason = '图片'; }
  else if (filter.blockRecord && types.includes('record')) { blocked = true; reason = '语音'; }
  else if (filter.blockForward && types.includes('forward')) { blocked = true; reason = '合并转发'; }
  else if (filter.blockLightApp && (raw.includes('[CQ:json,') || raw.includes('[CQ:xml,'))) { blocked = true; reason = '小程序卡片'; }
  else if (filter.blockContact && (raw.includes('"app":"com.tencent.contact.lua"') || raw.includes('"app":"com.tencent.qq.checkin"') || types.includes('contact'))) { blocked = true; reason = '名片分享'; }
  else if (filter.blockUrl) {
    const plainText = raw.replace(/\[CQ:[^\]]+\]/g, '');
    const urlPattern = /https?:\/\/\S+|www\.\S+|[a-zA-Z0-9][-a-zA-Z0-9]{0,62}\.(?:com|cn|net|org|io|cc|co|me|top|xyz|info|dev|app|site|vip|pro|tech|cloud|link|fun|icu|club|ltd|live|tv|asia|biz|wang|mobi|online|shop|store|work)\b/i;
    if (urlPattern.test(plainText)) { blocked = true; reason = '链接'; }
  }
  if (!blocked && filter.blockQr) {
    const images = messageSegments.filter((s: any) => s.type === 'image');
    for (const img of images) {
      const url = img.url || img.file;
      if (url && (url.startsWith('http') || url.startsWith('file://'))) {
        try {
          const hasQr = await detectQrCode(url);
          if (hasQr) {
            blocked = true;
            reason = '二维码';
            break;
          }
        } catch {}
      }
    }
  }
  if (!blocked) return false;
  await pluginState.callApi('delete_msg', { message_id: messageId });
  pluginState.log('info', `消息类型过滤: 群 ${groupId} 用户 ${userId} 发送${reason}，已撤回`);
  return true;
}

export async function executeHandleBlacklist(groupId: string, userId: string, messageId: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const isGlobalBlack = pluginState.isBlacklisted(userId);
  const isGroupBlack = (settings.groupBlacklist || []).includes(userId);
  if (isGlobalBlack || isGroupBlack) {
    await pluginState.callApi('delete_msg', { message_id: messageId });
    pluginState.debug(`黑名单拦截: 群 ${groupId} 用户 ${userId} 消息 ${messageId}`);
    return true;
  }
  return false;
}

export async function executeHandleFilterKeywords(groupId: string, userId: string, messageId: string, raw: string, ctx: NapCatPluginContext): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const groupKw = settings.filterKeywords || [];
  const globalKw = pluginState.config.filterKeywords || [];
  const allKw = [...new Set([...groupKw, ...globalKw])];
  if (!allKw.length) return false;
  const matched = allKw.find(k => raw.includes(k));
  if (!matched) return false;
  const masked = matched.length > 1 ? matched[0] + '*'.repeat(matched.length - 1) : '*';
  await pluginState.callApi('delete_msg', { message_id: messageId });
  pluginState.log('info', `违禁词拦截: 群 ${groupId} 用户 ${userId} 触发「${matched}」`);
  const level = settings.filterPunishLevel || 1;
  if (level >= 2) {
    const banMin = (groupKw && groupKw.length) ? (settings.filterBanMinutes || 10) : (pluginState.config.filterBanMinutes || 10);
    await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: userId, duration: banMin * 60 });
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 消息已撤回并禁言 ${banMin} 分钟，原因：触发违禁词「${masked}」`);
  }
  if (level >= 3) {
    setTimeout(() => pluginState.callApi('set_group_kick', { group_id: groupId, user_id: userId, reject_add_request: false }), 1000);
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 已被移出群聊，原因：触发违禁词「${masked}」`);
  }
  if (level >= 4) {
    if (!pluginState.config.blacklist) pluginState.config.blacklist = [];
    if (!pluginState.config.blacklist.includes(userId)) {
      pluginState.config.blacklist.push(userId);
      saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 已被加入黑名单，原因：触发违禁词「${masked}」`);
  }
  return true;
}

export async function executeHandleSpamDetect(groupId: string, userId: string, raw: string = ''): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const spamOn = settings.spamDetect !== undefined ? settings.spamDetect : pluginState.config.spamDetect;
  if (!spamOn) return false;
  const windowMs = ((settings.spamWindow !== undefined ? settings.spamWindow : pluginState.config.spamWindow) || 10) * 1000;
  const threshold = (settings.spamThreshold !== undefined ? settings.spamThreshold : pluginState.config.spamThreshold) || 10;
  const key = `${groupId}:${userId}`;
  const now = Date.now();
  let timestamps = pluginState.spamCache.get(key) || [];
  timestamps.push(now);
  timestamps = timestamps.filter(t => now - t < windowMs);
  pluginState.spamCache.set(key, timestamps);
  if (timestamps.length >= threshold) {
    const banMin = (settings.spamBanMinutes !== undefined ? settings.spamBanMinutes : pluginState.config.spamBanMinutes) || 5;
    await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: userId, duration: banMin * 60 });
    await pluginState.sendGroupText(groupId, `⚠️ ${userId} 刷屏检测触发（频率），已禁言 ${banMin} 分钟`);
    pluginState.spamCache.delete(key);
    pluginState.repeatCache.delete(key);
    pluginState.log('info', `刷屏检测: 群 ${groupId} 用户 ${userId} 在 ${windowMs / 1000}s 内发送 ${threshold} 条消息`);
    return true;
  }
  const repeatLimit = settings.repeatThreshold || 0;
  if (repeatLimit > 0 && raw) {
    const repeatKey = `${groupId}:${userId}`;
    const lastMsg = pluginState.repeatCache.get(repeatKey);
    if (lastMsg && lastMsg.content === raw) {
      lastMsg.count++;
      if (lastMsg.count >= repeatLimit) {
        const banMin = (settings.spamBanMinutes || 5);
        await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: userId, duration: banMin * 60 });
        await pluginState.sendGroupText(groupId, `⚠️ ${userId} 刷屏检测触发（复读），已禁言 ${banMin} 分钟`);
        pluginState.repeatCache.delete(repeatKey);
        return true;
      }
    } else {
      pluginState.repeatCache.set(repeatKey, { content: raw, count: 1 });
    }
  }
  return false;
}

export async function executeHandleQA(groupId: string, userId: string, raw: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  if (settings.disableQA) return false;
  const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
  const qaList = isGroupCustom ? (settings.qaList || []) : (pluginState.config.qaList || []);
  if (!qaList.length) return false;
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  if (text.startsWith('删问') || text.startsWith('模糊问') || text.startsWith('精确问') || text.startsWith('删除问答')) return false;
  for (const qa of qaList) {
    let matched = false;
    if (qa.mode === 'exact') matched = text === qa.keyword;
    else if (qa.mode === 'contains') matched = text.includes(qa.keyword);
    else if (qa.mode === 'regex') { try { matched = new RegExp(qa.keyword).test(text); } catch {} }
    if (!matched) continue;
    const now = Date.now();
    const baseCooldown = settings.qaCooldownSeconds ?? pluginState.config.global.qaCooldownSeconds ?? 30;
    const userCooldown = settings.qaUserCooldownSeconds ?? pluginState.config.global.qaUserCooldownSeconds ?? 12;
    const highPatterns = settings.qaHighRiskPatterns ?? pluginState.config.global.qaHighRiskPatterns ?? [];
    const mediumPatterns = settings.qaMediumRiskPatterns ?? pluginState.config.global.qaMediumRiskPatterns ?? [];
    const lowerText = text.toLowerCase();
    const lowerKeyword = qa.keyword.toLowerCase();
    const hitHigh = highPatterns.some(p => p && (lowerText.includes(String(p).toLowerCase()) || lowerKeyword.includes(String(p).toLowerCase())));
    const hitMedium = !hitHigh && mediumPatterns.some(p => p && (lowerText.includes(String(p).toLowerCase()) || lowerKeyword.includes(String(p).toLowerCase())));
    const tierCooldown = hitHigh
      ? (settings.qaTierCooldownHigh ?? pluginState.config.global.qaTierCooldownHigh ?? 60)
      : hitMedium
        ? (settings.qaTierCooldownMedium ?? pluginState.config.global.qaTierCooldownMedium ?? 30)
        : (settings.qaTierCooldownLow ?? pluginState.config.global.qaTierCooldownLow ?? 15);
    const groupKeywordKey = `${groupId}:${qa.mode}:${qa.keyword}`;
    const groupUserKey = `${groupId}:user:${userId}`;
    const groupUserKeywordKey = `${groupId}:user:${userId}:${qa.mode}:${qa.keyword}`;
    const lastGroupKeywordTs = pluginState.qaCooldownMap.get(groupKeywordKey) || 0;
    const lastGroupUserTs = pluginState.qaCooldownMap.get(groupUserKey) || 0;
    const lastGroupUserKeywordTs = pluginState.qaCooldownMap.get(groupUserKeywordKey) || 0;
    if (baseCooldown > 0 && now - lastGroupKeywordTs < baseCooldown * 1000) return false;
    if (userCooldown > 0 && now - lastGroupUserTs < userCooldown * 1000) return false;
    if (tierCooldown > 0 && now - lastGroupUserKeywordTs < tierCooldown * 1000) return false;
    pluginState.qaCooldownMap.set(groupKeywordKey, now);
    pluginState.qaCooldownMap.set(groupUserKey, now);
    pluginState.qaCooldownMap.set(groupUserKeywordKey, now);
    const reply = qa.reply.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
    if (reply.includes('[CQ:')) await pluginState.sendGroupMsg(groupId, [{ type: 'text', data: { text: reply } }], { force: false, applyTemplate: true });
    else await pluginState.sendGroupText(groupId, reply, { force: false, applyTemplate: true });
    pluginState.debug(`问答触发: 群 ${groupId} 用户 ${userId} 匹配 [${qa.mode}]${qa.keyword}`);
    return true;
  }
  return false;
}

export async function executeRecordActivity(groupId: string, userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();
  let activity = await groupguardRepository.getActivityAsync(groupId, userId);
  if (!activity) {
    activity = { msgCount: 0, lastActive: 0, role: 'member', msgCountToday: 0, lastActiveDay: today };
  }
  activity.msgCount++;
  activity.lastActive = now;
  if (activity.lastActiveDay !== today) {
    activity.lastActiveDay = today;
    activity.msgCountToday = 1;
  } else {
    activity.msgCountToday++;
  }
  await groupguardRepository.updateActivity(groupId, userId, activity);
}
