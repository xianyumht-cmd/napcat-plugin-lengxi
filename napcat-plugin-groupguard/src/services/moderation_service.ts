import { pluginState } from '../state';
import { authManager } from '../auth';
import { groupguardRepository } from '../repositories/groupguard_repository';
import { getTarget, isAdminOrOwner, saveConfig, sendGroupScene } from '../commands/common';
import type { CommandExecutionContext } from './command_service_types';

export async function executeModerationCommand(input: CommandExecutionContext): Promise<boolean> {
  const { raw, text, userId, groupId, ctx, event } = input;
  if (event.message_type !== 'group') return false;
  if (!authManager.getGroupLicense(groupId)) return false;

  if (text.startsWith('警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(3).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：警告@某人', { example: '警告@某人' }); return true; }
    const count = ((await groupguardRepository.getWarning(groupId, target)) || 0) + 1;
    await groupguardRepository.setWarning(groupId, target, count);
    const settings = pluginState.getGroupSettings(groupId);
    const limit = settings.warningLimit || 3;
    if (count >= limit) {
      await groupguardRepository.setWarning(groupId, target, 0);
      if (settings.warningAction === 'kick') {
        await pluginState.callApi('set_group_kick', { group_id: groupId, user_id: target, reject_add_request: false });
        await sendGroupScene(groupId, 'raw_text', `用户 ${target} 警告次数达到上限 (${count}/${limit})，已被踢出。`, { target, count, limit });
      } else {
        const banTime = (settings.filterBanMinutes || 10) * 60;
        await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: banTime });
        await sendGroupScene(groupId, 'raw_text', `用户 ${target} 警告次数达到上限 (${count}/${limit})，禁言 ${settings.filterBanMinutes} 分钟。`, { target, count, limit });
      }
    } else {
      await sendGroupScene(groupId, 'raw_text', `用户 ${target} 已被警告，当前次数：${count}/${limit}`, { target, count, limit });
    }
    return true;
  }
  if (text.startsWith('清除警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(5).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '清除警告@某人' }); return true; }
    const count = await groupguardRepository.getWarning(groupId, target);
    if (count > 0) { await groupguardRepository.setWarning(groupId, target, 0); await sendGroupScene(groupId, 'action_success', `已清除用户 ${target} 的警告记录`, { target }); }
    else await sendGroupScene(groupId, 'not_found', '该用户无警告记录');
    return true;
  }
  if (text.startsWith('查看警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(5).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '查看警告@某人' }); return true; }
    await sendGroupScene(groupId, 'raw_text', `用户 ${target} 当前警告次数：${await groupguardRepository.getWarning(groupId, target)}/${pluginState.getGroupSettings(groupId).warningLimit || 3}`, { target });
    return true;
  }
  if (text.startsWith('踢出')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(2).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：踢出@某人 或 踢出QQ号', { example: '踢出@某人' }); return true; }
    await pluginState.callApi('set_group_kick', { group_id: groupId, user_id: target, reject_add_request: false });
    await sendGroupScene(groupId, 'action_success', `已踢出 ${target}`, { target });
    return true;
  }
  if (text.startsWith('禁言') && !text.startsWith('禁言列表')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：禁言@某人 分钟 或 禁言QQ号 分钟', { example: '禁言@某人 10' }); return true; }
    const durationMatch = rest.replace(/\d{5,}/, '').match(/(\d+)/);
    const duration = durationMatch ? parseInt(durationMatch[1]) : 10;
    await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: duration * 60 });
    await sendGroupScene(groupId, 'action_success', `已禁言 ${target}，时长 ${duration} 分钟`, { target, duration });
    return true;
  }
  if (text.startsWith('解禁')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(2).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标：解禁@某人 或 解禁QQ号', { example: '解禁@某人' }); return true; }
    await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: 0 });
    await sendGroupScene(groupId, 'action_success', `已解禁 ${target}`, { target });
    return true;
  }
  if (text === '全体禁言' || text === '全体解禁') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    await pluginState.callApi('set_group_whole_ban', { group_id: groupId, enable: text === '全体禁言' });
    await sendGroupScene(groupId, 'action_success', text === '全体禁言' ? '已开启全体禁言' : '已关闭全体禁言');
    return true;
  }
  if (text.startsWith('授予头衔') || text.startsWith('清除头衔')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要群主权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '授予头衔@某人 高管' }); return true; }
    const title = text.startsWith('清除头衔') ? '' : rest.replace(/\[CQ:[^\]]+\]/g, '').replace(/\d{5,12}/, '').trim();
    await pluginState.callApi('set_group_special_title', { group_id: groupId, user_id: target, special_title: title });
    await sendGroupScene(groupId, 'action_success', text.startsWith('清除头衔') ? `已清除 ${target} 的头衔` : `已为 ${target} 设置头衔：${title || '(空)'}`, { target });
    return true;
  }
  if (text.startsWith('锁定名片') || text.startsWith('解锁名片')) {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(4).trim());
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '锁定名片@某人' }); return true; }
    if (text.startsWith('锁定名片')) {
      const info = await pluginState.callApi('get_group_member_info', { group_id: groupId, user_id: target }) as any;
      const card = info?.card || info?.nickname || '';
      pluginState.config.cardLocks[`${groupId}:${target}`] = card;
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已锁定 ${target} 的名片为：${card || '(空)'}`, { target });
    } else {
      delete pluginState.config.cardLocks[`${groupId}:${target}`];
      saveConfig(ctx);
      await sendGroupScene(groupId, 'action_success', `已解锁 ${target} 的名片`, { target });
    }
    return true;
  }
  if (text === '名片锁定列表') {
    const entries = Object.entries(pluginState.config.cardLocks).filter(([k]) => k.startsWith(groupId + ':'));
    await sendGroupScene(groupId, entries.length ? 'raw_text' : 'list_empty', entries.length ? `名片锁定列表：\n${entries.map(([k, v]) => `${k.split(':')[1]} → ${v}`).join('\n')}` : '当前群没有锁定的名片');
    return true;
  }
  if (text === '开启防撤回' || text === '关闭防撤回' || text === '防撤回列表') {
    if (text === '防撤回列表') { await sendGroupScene(groupId, pluginState.config.antiRecallGroups.length ? 'raw_text' : 'list_empty', pluginState.config.antiRecallGroups.length ? `防撤回已开启的群：\n${pluginState.config.antiRecallGroups.join('\n')}` : '没有开启防撤回的群'); return true; }
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (text === '开启防撤回') {
      if (!pluginState.config.antiRecallGroups.includes(groupId)) pluginState.config.antiRecallGroups.push(groupId);
    } else {
      pluginState.config.antiRecallGroups = pluginState.config.antiRecallGroups.filter(g => g !== groupId);
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '开启防撤回' ? '已开启防撤回' : '已关闭防撤回');
    return true;
  }
  if (text === '开启回应表情' || text === '关闭回应表情') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (text === '开启回应表情') pluginState.config.emojiReactGroups[groupId] = pluginState.config.emojiReactGroups[groupId] || [];
    else delete pluginState.config.emojiReactGroups[groupId];
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '开启回应表情' ? '已开启回应表情' : '已关闭回应表情');
    return true;
  }
  if (text.startsWith('针对') || text.startsWith('取消针对') || text === '针对列表' || text === '清除针对') {
    if (text === '针对列表') {
      const list = pluginState.getGroupSettings(groupId).targetUsers || [];
      await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `当前群针对列表：\n${list.join('\n')}` : '当前群没有针对的用户');
      return true;
    }
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const cfg = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal ? pluginState.config.groups[groupId] : pluginState.config.global;
    if (!cfg.targetUsers) cfg.targetUsers = [];
    if (text === '清除针对') cfg.targetUsers = [];
    else {
      const target = getTarget(raw, text.startsWith('取消针对') ? text.slice(4).trim() : text.slice(2).trim());
      if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '针对@某人' }); return true; }
      if (text.startsWith('取消针对')) cfg.targetUsers = cfg.targetUsers.filter(t => t !== target);
      else if (!cfg.targetUsers.includes(target)) cfg.targetUsers.push(target);
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '针对列表已更新');
    return true;
  }
  if (text.startsWith('拉黑') || text.startsWith('取消拉黑') || text === '黑名单列表' || text.startsWith('群拉黑') || text.startsWith('群取消拉黑') || text === '群黑名单列表' || (text.startsWith('白名单') && text !== '白名单列表') || text.startsWith('取消白名单') || text === '白名单列表') {
    if (text === '黑名单列表') { const list = pluginState.config.blacklist || []; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `全局黑名单：\n${list.join('\n')}` : '黑名单为空'); return true; }
    if (text === '群黑名单列表') { const list = pluginState.getGroupSettings(groupId).groupBlacklist || []; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `本群黑名单：\n${list.join('\n')}` : '本群黑名单为空'); return true; }
    if (text === '白名单列表') { const list = pluginState.config.whitelist || []; await sendGroupScene(groupId, list.length ? 'raw_text' : 'list_empty', list.length ? `全局白名单：\n${list.join('\n')}` : '白名单为空'); return true; }
    const isOwnerCmd = text.startsWith('拉黑') || text.startsWith('取消拉黑') || text.startsWith('白名单') || text.startsWith('取消白名单');
    if (isOwnerCmd && !pluginState.isOwner(userId)) { await sendGroupScene(groupId, 'permission_denied', '需要主人权限'); return true; }
    if (!isOwnerCmd && !await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    const source = text.startsWith('取消拉黑') ? text.slice(4).trim() : text.startsWith('拉黑') ? text.slice(2).trim() : text.startsWith('群取消拉黑') ? text.slice(5).trim() : text.startsWith('群拉黑') ? text.slice(3).trim() : text.startsWith('取消白名单') ? text.slice(5).trim() : text.slice(3).trim();
    const target = getTarget(raw, source);
    if (!target) { await sendGroupScene(groupId, 'command_format_error', '请指定目标', { example: '拉黑@某人' }); return true; }
    if (text.startsWith('拉黑')) { pluginState.config.blacklist = pluginState.config.blacklist || []; if (!pluginState.config.blacklist.includes(target)) pluginState.config.blacklist.push(target); }
    if (text.startsWith('取消拉黑')) pluginState.config.blacklist = (pluginState.config.blacklist || []).filter(q => q !== target);
    if (text.startsWith('群拉黑')) { if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) }; const gs = pluginState.config.groups[groupId]; gs.groupBlacklist = gs.groupBlacklist || []; if (!gs.groupBlacklist.includes(target)) gs.groupBlacklist.push(target); }
    if (text.startsWith('群取消拉黑')) { if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) }; const gs = pluginState.config.groups[groupId]; gs.groupBlacklist = (gs.groupBlacklist || []).filter(q => q !== target); }
    if (text.startsWith('白名单') && text !== '白名单列表') { pluginState.config.whitelist = pluginState.config.whitelist || []; if (!pluginState.config.whitelist.includes(target)) pluginState.config.whitelist.push(target); }
    if (text.startsWith('取消白名单')) pluginState.config.whitelist = (pluginState.config.whitelist || []).filter(q => q !== target);
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', '名单已更新');
    return true;
  }
  if (text.startsWith('开启自身撤回') || text === '关闭自身撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await sendGroupScene(groupId, 'permission_denied', '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (text === '关闭自身撤回') pluginState.config.groups[groupId].autoRecallSelf = false;
    else {
      pluginState.config.groups[groupId].autoRecallSelf = true;
      const duration = parseInt(text.slice(6).trim());
      pluginState.config.groups[groupId].autoRecallSelfDelay = isNaN(duration) ? 60 : duration;
    }
    saveConfig(ctx);
    await sendGroupScene(groupId, 'action_success', text === '关闭自身撤回' ? '已关闭自身消息撤回' : `已开启自身消息撤回，延迟 ${pluginState.config.groups[groupId].autoRecallSelfDelay || 60} 秒`);
    return true;
  }

  return false;
}
