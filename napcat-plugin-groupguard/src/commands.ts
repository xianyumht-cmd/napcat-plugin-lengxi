// 群管指令处理
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from './state';
import { dbQuery } from './db';
import { authManager } from './auth';
import { GROUP_ADMIN_MENU, ANTI_RECALL_MENU, EMOJI_REACT_MENU, TARGET_MENU, BLACKWHITE_MENU, FILTER_MENU, QA_MENU, REJECT_KW_MENU, AUTH_MENU, INTERACT_MENU, RISK_CONTROL_MENU } from './config';
import fs from 'fs';
import path from 'path';
import { detectQrCode } from './qr';

/** 从消息中提取 @的QQ号 */
function extractAt (raw: string): string | null {
  const m = raw.match(/\[CQ:at,qq=(\d+)\]/);
  return m ? m[1] : null;
}

/** 从文本中提取QQ号 */
function extractQQ (text: string): string | null {
  const m = text.match(/(\d{5,12})/);
  return m ? m[1] : null;
}

/** 提取目标QQ（优先@，其次纯数字） */
function getTarget (raw: string, textAfterCmd: string): string | null {
  return extractAt(raw) || extractQQ(textAfterCmd);
}

/** 检查是否是管理员或主人 */
async function isAdminOrOwner (groupId: string, userId: string): Promise<boolean> {
  if (pluginState.isOwner(userId)) return true;
  
  const key = `${groupId}:${userId}`;
  const settings = pluginState.getGroupSettings(groupId);
  const cacheSeconds = settings.adminCacheSeconds !== undefined ? settings.adminCacheSeconds : 60; // 默认60秒缓存
  
  if (cacheSeconds > 0) {
      const cached = pluginState.adminCache.get(key);
      if (cached && Date.now() < cached.expire) {
          return cached.role === 'admin' || cached.role === 'owner';
      }
  }

  const info = await pluginState.callApi('get_group_member_info', { group_id: groupId, user_id: userId }) as any;
  const role = info?.role || 'member';
  
  if (cacheSeconds > 0) {
      pluginState.adminCache.set(key, { role, expire: Date.now() + cacheSeconds * 1000 });
  }
  
  return role === 'admin' || role === 'owner';
}

/** 保存配置到文件 */
export function saveConfig (ctx: NapCatPluginContext): void {
  try {
    if (ctx?.configPath) {
      // 1. 保存主配置（不包含 groups）
      const mainConfig = { ...pluginState.config, groups: {} };
      fs.writeFileSync(ctx.configPath, JSON.stringify(mainConfig, null, 2), 'utf-8');
      
      // 2. 保存分群配置到 data/groups/{gid}/config.json
      const dataDir = path.join(path.dirname(ctx.configPath), 'data');
      const groupsDir = path.join(dataDir, 'groups');
      if (!fs.existsSync(groupsDir)) fs.mkdirSync(groupsDir, { recursive: true });
      
      for (const [gid, cfg] of Object.entries(pluginState.config.groups)) {
        if (cfg) {
          const groupDir = path.join(groupsDir, gid);
          if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
          fs.writeFileSync(path.join(groupDir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf-8');
        }
      }
    }
  } catch (e) {
    pluginState.log('error', `保存配置失败: ${e}`);
  }
}

/** 处理群管指令，返回 true 表示已处理 */
export async function handleCommand (event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const selfId = String(event.self_id);

  // 处理私聊命令（仅限主人）
  if (event.message_type === 'private') {
    // 日志记录私聊尝试，方便调试
    pluginState.debug(`收到私聊指令: [${userId}] ${text}`);

    // 帮助菜单允许所有用户查看，但会提示权限差异
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

    // 敏感指令严格检查 Owner 权限
    if (!pluginState.isOwner(userId)) {
        pluginState.debug(`非主人用户 ${userId} 尝试执行私聊管理指令被拦截`);
        return false;
    }

    try {
      if (text.startsWith('授权 ')) {
        const parts = text.split(' ');
        if (parts.length < 3) {
          await pluginState.sendPrivateMsg(userId, '格式错误：授权 <群号> <天数>');
          return true;
        }
        const targetGroup = parts[1];
        const duration = parts[2];
        const days = duration === '永久' ? -1 : parseInt(duration);
        if (!/^\d+$/.test(targetGroup)) {
          await pluginState.sendPrivateMsg(userId, '群号格式错误');
          return true;
        }
        // 永久授权默认为企业版，限时默认为专业版
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
      if (text === '帮助' || text === '菜单') {
          // 已在上文处理，此处逻辑保留但实际上不会走到
          return true;
      }
    } catch (e) {
      pluginState.log('error', `处理私聊指令出错: ${e}`);
      await pluginState.sendPrivateMsg(userId, `指令执行出错: ${e}`);
      return true;
    }
    return false;
  }

  const groupId = String(event.group_id);

  // 检查授权状态：未授权群仅允许执行授权相关指令，其余指令静默忽略
  const license = authManager.getGroupLicense(groupId);
  // 群内不再响应授权指令，改为仅支持私聊授权
  if (!license) {
    return false;
  }

  // ===== 帮助 =====
  // 移除群内帮助指令响应
  if (text === '群管帮助' || text === '群管菜单') {
    return false;
  }
  
  // 新增风控菜单
  if (text === '风控设置' || text === '安全设置') {
      const selfId = String((event as any).self_id || '');
      const nodes = [
          { type: 'node', data: { nickname: '🛡️ 风控配置', user_id: selfId, content: [{ type: 'text', data: { text: RISK_CONTROL_MENU } }] } }
      ];
      await pluginState.callApi('send_group_forward_msg', { group_id: groupId, messages: nodes });
      return true;
  }

  // ===== 权限缓存设置 =====
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

  // ===== 授权管理 (群内不再响应，仅支持私聊) =====
  if (text.startsWith('授权 ') || text.startsWith('回收授权') || text.startsWith('查询授权') || text === '授权查询') {
    return false;
  }

  // ===== 警告系统 =====
  if (text.startsWith('警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(3).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：警告@某人'); return true; }
    
    const count = ((await dbQuery.getWarning(groupId, target)) || 0) + 1;
    await dbQuery.setWarning(groupId, target, count);
    
    const settings = pluginState.getGroupSettings(groupId);
    const limit = settings.warningLimit || 3;
    
    if (count >= limit) {
        await dbQuery.setWarning(groupId, target, 0);
        if (settings.warningAction === 'kick') {
            await pluginState.callApi('set_group_kick', { group_id: groupId, user_id: target, reject_add_request: false });
            await pluginState.sendGroupText(groupId, `用户 ${target} 警告次数达到上限 (${count}/${limit})，已被踢出。`);
        } else {
            const banTime = (settings.filterBanMinutes || 10) * 60;
            await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: banTime });
            await pluginState.sendGroupText(groupId, `用户 ${target} 警告次数达到上限 (${count}/${limit})，禁言 ${settings.filterBanMinutes} 分钟。`);
        }
    } else {
        await pluginState.sendGroupText(groupId, `用户 ${target} 已被警告，当前次数：${count}/${limit}`);
    }
    return true;
  }
  
  if (text.startsWith('清除警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(5).trim());
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    const count = await dbQuery.getWarning(groupId, target);
    if (count > 0) {
        await dbQuery.setWarning(groupId, target, 0);
        await pluginState.sendGroupText(groupId, `已清除用户 ${target} 的警告记录`);
    } else {
        await pluginState.sendGroupText(groupId, `该用户无警告记录`);
    }
    return true;
  }

  if (text.startsWith('查看警告 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const target = getTarget(raw, text.slice(5).trim());
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    const count = await dbQuery.getWarning(groupId, target);
    const settings = pluginState.getGroupSettings(groupId);
    await pluginState.sendGroupText(groupId, `用户 ${target} 当前警告次数：${count}/${settings.warningLimit || 3}`);
    return true;
  }

  // ===== 宵禁管理 =====
  if (text.startsWith('开启宵禁 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!authManager.checkFeature(groupId, 'curfew')) { await pluginState.sendGroupText(groupId, '宵禁功能仅限专业版/企业版使用，请购买授权。'); return true; }
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
  
  if (text === '关闭宵禁') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (pluginState.config.groups[groupId]) {
        pluginState.config.groups[groupId].enableCurfew = false;
        saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, '已关闭宵禁');
    return true;
  }

  // ===== 欢迎词设置 =====
  if (text.startsWith('设置欢迎词 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const msg = text.slice(6).trim();
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].welcomeMessage = msg;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '欢迎词已更新');
    return true;
  }
  
  // ===== 定时任务 =====
  if (text.startsWith('定时任务 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!authManager.checkFeature(groupId, 'scheduled_tasks')) { await pluginState.sendGroupText(groupId, '定时任务仅限专业版/企业版使用，请购买授权。'); return true; }
    
    // 格式：定时任务 08:00 内容
    const parts = text.split(/\s+/);
    if (parts.length < 3) { await pluginState.sendGroupText(groupId, '格式：定时任务 08:00 内容'); return true; }
    
    const time = parts[1];
    if (!/^\d{2}:\d{2}$/.test(time)) { await pluginState.sendGroupText(groupId, '时间格式错误，应为 HH:mm'); return true; }
    
    const content = parts.slice(2).join(' ');
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.scheduledTasks) gs.scheduledTasks = [];
    
    const id = Date.now().toString(36);
    gs.scheduledTasks.push({
        id,
        cron: time,
        type: 'text',
        content
    });
    
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已添加定时任务 (ID:${id})：每天 ${time} 发送 "${content}"`);
    return true;
  }

  if (text.startsWith('删除定时任务 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const id = text.slice(7).trim();
    if (!pluginState.config.groups[groupId]?.scheduledTasks) { await pluginState.sendGroupText(groupId, '本群无定时任务'); return true; }
    
    const gs = pluginState.config.groups[groupId];
    const before = gs.scheduledTasks!.length;
    gs.scheduledTasks = gs.scheduledTasks!.filter(t => t.id !== id);
    
    if (gs.scheduledTasks.length === before) {
        await pluginState.sendGroupText(groupId, '未找到该ID的任务');
    } else {
        saveConfig(ctx);
        await pluginState.sendGroupText(groupId, '已删除定时任务');
    }
    return true;
  }

  if (text === '定时列表') {
    const tasks = pluginState.config.groups[groupId]?.scheduledTasks || [];
    if (!tasks.length) { await pluginState.sendGroupText(groupId, '本群无定时任务'); return true; }
    
    const list = tasks.map(t => `[${t.id}] ${t.cron} -> ${t.content}`).join('\n');
    await pluginState.sendGroupText(groupId, `定时任务列表：\n${list}`);
    return true;
  }

  // ===== 签到系统 =====
  if (text === '签到') {
    if (pluginState.getGroupSettings(groupId).disableSignin) { await pluginState.sendGroupText(groupId, '本群签到功能已关闭'); return true; }
    
    let userSignin = await dbQuery.getSignin(groupId, userId);
    if (!userSignin) {
        userSignin = { lastSignin: 0, days: 0, points: 0 };
    }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    if (userSignin.lastSignin >= today) {
        await pluginState.sendGroupMsg(groupId, [
            { type: 'at', data: { qq: userId } },
            { type: 'text', data: { text: ' 你今天已经签到过了，明天再来吧！' } }
        ]);
        return true;
    }
    
    // 检查连续签到
    const yesterday = today - 86400000;
    if (userSignin.lastSignin >= yesterday && userSignin.lastSignin < today) {
        userSignin.days++;
    } else {
        userSignin.days = 1;
    }
    
    // 计算积分 (配置范围 + 连签奖励)
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
    ]);
    return true;
  }
  
  if (text === '签到榜') {
    const data = await dbQuery.getAllSignin(groupId);
    if (!Object.keys(data).length) { await pluginState.sendGroupText(groupId, '本群暂无签到数据'); return true; }
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    
    const list = Object.entries(data)
        .filter(([_, v]) => v.lastSignin >= today)
        .sort((a, b) => b[1].lastSignin - a[1].lastSignin) // 按时间倒序
        .slice(0, 10);
        
    if (!list.length) { await pluginState.sendGroupText(groupId, '今天还没有人签到哦'); return true; }
    
    const content = list.map((item, i) => {
        const time = new Date(item[1].lastSignin).toLocaleTimeString();
        return `${i + 1}. ${item[0]} (${time})`;
    }).join('\n');
    
    await pluginState.sendGroupText(groupId, `📅 今日签到榜\n${content}`);
    return true;
  }
  
  if (text === '我的积分') {
    const data = await dbQuery.getSignin(groupId, userId);
    const points = data ? data.points : 0;
    await pluginState.sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ` 你的当前积分：${points}` } }
    ]);
    return true;
  }

  // ===== 邀请统计 =====
  if (text === '邀请查询') {
    const data = await dbQuery.getInvite(groupId, userId);
    const count = data ? data.inviteCount : 0;
    await pluginState.sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ` 你已邀请 ${count} 人加入本群` } }
    ]);
    return true;
  }
  
  if (text === '邀请榜') {
    const data = await dbQuery.getAllInvites(groupId);
    if (!Object.keys(data).length) { await pluginState.sendGroupText(groupId, '本群暂无邀请数据'); return true; }
    
    const list = Object.entries(data)
        .sort((a, b) => b[1].inviteCount - a[1].inviteCount)
        .slice(0, 10);
        
    const content = list.map((item, i) => `${i + 1}. ${item[0]} - 邀请 ${item[1].inviteCount} 人`).join('\n');
    await pluginState.sendGroupText(groupId, `🏆 邀请排行榜\n${content}`);
    return true;
  }
  
  if (text.startsWith('激活 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    // 简单的卡密模拟逻辑：PRO-30-XXXX
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
  
  // ===== 运行状态 =====
  if (text === '运行状态') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const uptime = Math.floor((Date.now() - pluginState.startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    const mem = process.memoryUsage();
    const rss = (mem.rss / 1024 / 1024).toFixed(2);
    const heap = (mem.heapUsed / 1024 / 1024).toFixed(2);
    
    // 缓存统计
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

  // ===== 抽奖系统 =====
  if (text === '抽奖') {
    if (pluginState.getGroupSettings(groupId).disableLottery) { await pluginState.sendGroupText(groupId, '本群抽奖功能已关闭'); return true; }
    
    let userSignin = await dbQuery.getSignin(groupId, userId);
    
    const settings = pluginState.getGroupSettings(groupId);
    const cost = settings.lotteryCost || 20;
    const maxReward = settings.lotteryReward || 100;

    if (!userSignin || userSignin.points < cost) {
        await pluginState.sendGroupMsg(groupId, [
            { type: 'at', data: { qq: userId } },
            { type: 'text', data: { text: ` 积分不足！抽奖需要${cost}积分，请先签到获取积分。` } }
        ]);
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
    
    await pluginState.sendGroupMsg(groupId, [
        { type: 'at', data: { qq: userId } },
        { type: 'text', data: { text: ` 消耗${cost}积分抽奖...\n🎉 ${prize}\n当前积分：${userSignin.points}` } }
    ]);
    return true;
  }
  
  // ===== 发言奖励 =====
  if (text.startsWith('开启发言奖励 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const points = parseInt(text.slice(7));
    if (isNaN(points) || points <= 0) { await pluginState.sendGroupText(groupId, '请输入正确的积分数'); return true; }
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].messageReward = points;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已开启发言奖励，每条消息奖励 ${points} 积分`);
    return true;
  }
  
  if (text === '关闭发言奖励') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (pluginState.config.groups[groupId]) {
        pluginState.config.groups[groupId].messageReward = 0;
        saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, '已关闭发言奖励');
    return true;
  }

  // ===== 踢出 =====
  if (text.startsWith('踢出')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：踢出@某人 或 踢出QQ号'); return true; }
    await pluginState.callApi('set_group_kick', { group_id: groupId, user_id: target, reject_add_request: false });
    await pluginState.sendGroupText(groupId, `已踢出 ${target}`);
    return true;
  }

  // ===== 禁言 =====
  if (text.startsWith('禁言') && !text.startsWith('禁言列表')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：禁言@某人 分钟 或 禁言QQ号 分钟'); return true; }
    const durationMatch = rest.replace(/\d{5,}/, '').match(/(\d+)/);
    const duration = durationMatch ? parseInt(durationMatch[1]) : 10;
    await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: duration * 60 });
    await pluginState.sendGroupText(groupId, `已禁言 ${target}，时长 ${duration} 分钟`);
    return true;
  }

  // ===== 解禁 =====
  if (text.startsWith('解禁')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：解禁@某人 或 解禁QQ号'); return true; }
    await pluginState.callApi('set_group_ban', { group_id: groupId, user_id: target, duration: 0 });
    await pluginState.sendGroupText(groupId, `已解禁 ${target}`);
    return true;
  }

  // ===== 全体禁言/解禁 =====
  if (text === '全体禁言') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    await pluginState.callApi('set_group_whole_ban', { group_id: groupId, enable: true });
    await pluginState.sendGroupText(groupId, '已开启全体禁言');
    return true;
  }
  if (text === '全体解禁') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    await pluginState.callApi('set_group_whole_ban', { group_id: groupId, enable: false });
    await pluginState.sendGroupText(groupId, '已关闭全体禁言');
    return true;
  }

  // ===== 授予头衔 =====
  if (text.startsWith('授予头衔')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要群主权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：授予头衔@某人 内容'); return true; }
    const title = rest.replace(/\[CQ:[^\]]+\]/g, '').replace(/\d{5,12}/, '').trim();
    await pluginState.callApi('set_group_special_title', { group_id: groupId, user_id: target, special_title: title });
    await pluginState.sendGroupText(groupId, `已为 ${target} 设置头衔：${title || '(空)'}`);
    return true;
  }

  // ===== 清除头衔 =====
  if (text.startsWith('清除头衔')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要群主权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    await pluginState.callApi('set_group_special_title', { group_id: groupId, user_id: target, special_title: '' });
    await pluginState.sendGroupText(groupId, `已清除 ${target} 的头衔`);
    return true;
  }

  // ===== 锁定名片 =====
  if (text.startsWith('锁定名片')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    const info = await pluginState.callApi('get_group_member_info', { group_id: groupId, user_id: target }) as any;
    const card = info?.card || info?.nickname || '';
    pluginState.config.cardLocks[`${groupId}:${target}`] = card;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已锁定 ${target} 的名片为：${card || '(空)'}`);
    return true;
  }

  // ===== 解锁名片 =====
  if (text.startsWith('解锁名片')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    delete pluginState.config.cardLocks[`${groupId}:${target}`];
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已解锁 ${target} 的名片`);
    return true;
  }

  // ===== 名片锁定列表 =====
  if (text === '名片锁定列表') {
    const locks = pluginState.config.cardLocks;
    const entries = Object.entries(locks).filter(([k]) => k.startsWith(groupId + ':'));
    if (!entries.length) { await pluginState.sendGroupText(groupId, '当前群没有锁定的名片'); return true; }
    const list = entries.map(([k, v]) => `${k.split(':')[1]} → ${v}`).join('\n');
    await pluginState.sendGroupText(groupId, `名片锁定列表：\n${list}`);
    return true;
  }

  // ===== 防撤回 =====
  if (text === '开启防撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!authManager.checkFeature(groupId, 'anti_recall')) { await pluginState.sendGroupText(groupId, '此功能仅限专业版/企业版使用，请购买授权。'); return true; }
    if (!pluginState.config.antiRecallGroups) pluginState.config.antiRecallGroups = [];
    if (!pluginState.config.antiRecallGroups.includes(groupId)) { pluginState.config.antiRecallGroups.push(groupId); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, '已开启防撤回');
    return true;
  }
  if (text === '关闭防撤回') {
    if (!pluginState.isOwner(userId) && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    pluginState.config.antiRecallGroups = pluginState.config.antiRecallGroups.filter(g => g !== groupId);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭防撤回');
    return true;
  }
  if (text === '防撤回列表') {
    const list = pluginState.config.antiRecallGroups;
    await pluginState.sendGroupText(groupId, list.length ? `防撤回已开启的群：\n${list.join('\n')}` : '没有开启防撤回的群');
    return true;
  }

  // ===== 回应表情 =====
  if (text === '开启回应表情') {
    if (!pluginState.isOwner(userId) && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.emojiReactGroups[groupId]) pluginState.config.emojiReactGroups[groupId] = [];
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启回应表情');
    return true;
  }
  if (text === '关闭回应表情') {
    if (!pluginState.isOwner(userId) && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    delete pluginState.config.emojiReactGroups[groupId];
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭回应表情');
    return true;
  }

  // ===== 针对（自动撤回） =====
  if (text.startsWith('针对') && text !== '针对列表') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：针对@某人 或 针对+QQ号'); return true; }
    const cfg = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal ? pluginState.config.groups[groupId] : pluginState.config.global;
    if (!cfg.targetUsers) cfg.targetUsers = [];
    if (!cfg.targetUsers.includes(target)) { cfg.targetUsers.push(target); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已针对 ${target}，其消息将被自动撤回`);
    return true;
  }
  if (text.startsWith('取消针对')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    const cfg = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal ? pluginState.config.groups[groupId] : pluginState.config.global;
    if (cfg.targetUsers) { cfg.targetUsers = cfg.targetUsers.filter(t => t !== target); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已取消针对 ${target}`);
    return true;
  }
  if (text === '针对列表') {
    const settings = pluginState.getGroupSettings(groupId);
    const list = settings.targetUsers || [];
    await pluginState.sendGroupText(groupId, list.length ? `当前群针对列表：\n${list.join('\n')}` : '当前群没有针对的用户');
    return true;
  }
  if (text === '清除针对') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const cfg = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal ? pluginState.config.groups[groupId] : pluginState.config.global;
    cfg.targetUsers = [];
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已清除当前群所有针对');
    return true;
  }

  // ===== 自身撤回 =====
  if (text.startsWith('开启自身撤回')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(6).trim();
    const duration = parseInt(rest);
    const delay = isNaN(duration) ? 60 : duration;
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    gs.autoRecallSelf = true;
    gs.autoRecallSelfDelay = delay;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已开启自身消息撤回，延迟 ${delay} 秒`);
    return true;
  }

  if (text === '关闭自身撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (pluginState.config.groups[groupId]) {
        pluginState.config.groups[groupId].autoRecallSelf = false;
        saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, '已关闭自身消息撤回');
    return true;
  }

  // ===== 黑名单 =====
  if (text.startsWith('拉黑')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    if (!authManager.checkFeature(groupId, 'global_blacklist')) { await pluginState.sendGroupText(groupId, '全局黑名单仅限企业版使用，请使用群拉黑或购买企业授权。'); return true; }
    const rest = text.slice(2).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：拉黑@某人 或 拉黑QQ号'); return true; }
    if (!pluginState.config.blacklist) pluginState.config.blacklist = [];
    if (!pluginState.config.blacklist.includes(target)) { pluginState.config.blacklist.push(target); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已将 ${target} 加入全局黑名单`);
    return true;
  }
  if (text.startsWith('取消拉黑')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const rest = text.slice(4).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    pluginState.config.blacklist = (pluginState.config.blacklist || []).filter(q => q !== target);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已将 ${target} 移出黑名单`);
    return true;
  }
  if (text === '黑名单列表') {
    const list = pluginState.config.blacklist || [];
    await pluginState.sendGroupText(groupId, list.length ? `全局黑名单：\n${list.join('\n')}` : '黑名单为空');
    return true;
  }

  // ===== 群独立黑名单 =====
  if (text.startsWith('群拉黑')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(3).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：群拉黑@某人 或 群拉黑QQ号'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.groupBlacklist) gs.groupBlacklist = [];
    if (!gs.groupBlacklist.includes(target)) { gs.groupBlacklist.push(target); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已将 ${target} 加入本群黑名单`);
    return true;
  }
  if (text.startsWith('群取消拉黑')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const rest = text.slice(5).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    if (pluginState.config.groups[groupId]) {
      const gs = pluginState.config.groups[groupId];
      gs.groupBlacklist = (gs.groupBlacklist || []).filter(q => q !== target);
      saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, `已将 ${target} 移出本群黑名单`);
    return true;
  }
  if (text === '群黑名单列表') {
    const settings = pluginState.getGroupSettings(groupId);
    const list = settings.groupBlacklist || [];
    await pluginState.sendGroupText(groupId, list.length ? `本群黑名单：\n${list.join('\n')}` : '本群黑名单为空');
    return true;
  }

  // ===== 白名单 =====
  if (text.startsWith('白名单') && text !== '白名单列表') {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const rest = text.slice(3).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标：白名单@某人 或 白名单QQ号'); return true; }
    if (!pluginState.config.whitelist) pluginState.config.whitelist = [];
    if (!pluginState.config.whitelist.includes(target)) { pluginState.config.whitelist.push(target); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已将 ${target} 加入白名单`);
    return true;
  }
  if (text.startsWith('取消白名单')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const rest = text.slice(5).trim();
    const target = getTarget(raw, rest);
    if (!target) { await pluginState.sendGroupText(groupId, '请指定目标'); return true; }
    pluginState.config.whitelist = (pluginState.config.whitelist || []).filter(q => q !== target);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已将 ${target} 移出白名单`);
    return true;
  }
  if (text === '白名单列表') {
    const list = pluginState.config.whitelist || [];
    await pluginState.sendGroupText(groupId, list.length ? `全局白名单：\n${list.join('\n')}` : '白名单为空');
    return true;
  }

  // ===== 违禁词管理 =====
  if (text.startsWith('添加违禁词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词：添加违禁词 词语'); return true; }
    if (!pluginState.config.filterKeywords) pluginState.config.filterKeywords = [];
    if (!pluginState.config.filterKeywords.includes(word)) { pluginState.config.filterKeywords.push(word); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已添加违禁词：${word}`);
    return true;
  }
  if (text.startsWith('删除违禁词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词'); return true; }
    pluginState.config.filterKeywords = (pluginState.config.filterKeywords || []).filter(w => w !== word);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已删除违禁词：${word}`);
    return true;
  }
  if (text === '违禁词列表') {
    const list = pluginState.config.filterKeywords || [];
    await pluginState.sendGroupText(groupId, list.length ? `违禁词列表：\n${list.join('、')}` : '违禁词列表为空');
    return true;
  }

  // ===== 入群审核拒绝关键词 =====
  if (text.startsWith('添加拒绝词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词：添加拒绝词 词语'); return true; }
    if (!pluginState.config.rejectKeywords) pluginState.config.rejectKeywords = [];
    if (!pluginState.config.rejectKeywords.includes(word)) { pluginState.config.rejectKeywords.push(word); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已添加入群拒绝关键词：${word}`);
    return true;
  }
  if (text.startsWith('删除拒绝词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }
    pluginState.config.rejectKeywords = (pluginState.config.rejectKeywords || []).filter(w => w !== word);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已删除入群拒绝关键词：${word}`);
    return true;
  }
  if (text === '拒绝词列表') {
    const list = pluginState.config.rejectKeywords || [];
    await pluginState.sendGroupText(groupId, list.length ? `入群拒绝关键词列表：\n${list.join('、')}` : '拒绝关键词列表为空');
    return true;
  }

  // ===== 问答管理 =====
  if (text === '问答列表') {
    const settings = pluginState.getGroupSettings(groupId);
    const groupQa = settings.qaList || [];
    const globalQa = pluginState.config.qaList || [];
    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    const list = isGroupCustom ? groupQa : globalQa;
    const label = isGroupCustom ? '本群' : '全局';
    if (!list.length) { await pluginState.sendGroupText(groupId, `${label}问答列表为空`); return true; }
    const modeMap: Record<string, string> = { exact: '精确', contains: '模糊', regex: '正则' };
    const txt = list.map((q, i) => `${i + 1}. [${modeMap[q.mode] || q.mode}] ${q.keyword} → ${q.reply}`).join('\n');
    await pluginState.sendGroupText(groupId, `${label}问答列表：\n${txt}`);
    return true;
  }
  // ===== 问答设置 =====
  // 语法：模糊问XX答YY | 精确问XX答YY
  if (text.startsWith('模糊问') || text.startsWith('精确问')) {
    if (!pluginState.isOwner(userId) && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    
    let mode = 'contains';
    let rest = '';
    
    if (text.startsWith('模糊问')) {
        mode = 'contains';
        rest = text.slice(3);
    } else if (text.startsWith('精确问')) {
        mode = 'exact';
        rest = text.slice(3);
    }
    
    const sep = rest.indexOf('答');
    if (sep < 1) { await pluginState.sendGroupText(groupId, '格式错误，示例：模糊问你好答在的 | 精确问帮助答请看菜单'); return true; }
    
    const keyword = rest.slice(0, sep).trim();
    const reply = rest.slice(sep + 1).trim();
    
    if (!keyword || !reply) { await pluginState.sendGroupText(groupId, '关键词和回复不能为空'); return true; }
    
    // 判断当前编辑的是群级还是全局
    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    if (isGroupCustom) {
      const gs = pluginState.config.groups[groupId];
      if (!gs.qaList) gs.qaList = [];
      gs.qaList.push({ keyword, reply, mode });
    } else {
      // 默认创建群独立配置
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId), useGlobal: false, qaList: [] };
      if (!pluginState.config.groups[groupId].qaList) pluginState.config.groups[groupId].qaList = [];
      pluginState.config.groups[groupId].qaList!.push({ keyword, reply, mode });
    }
    saveConfig(ctx);
    const modeMap: Record<string, string> = { exact: '精确', contains: '模糊', regex: '正则' };
    await pluginState.sendGroupText(groupId, `已添加${modeMap[mode]}问答：${keyword} → ${reply}`);
    return true;
  }

  // 兼容旧指令
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
  
  if (text.startsWith('添加问答 ') || text.startsWith('添加模糊问答 ')) {
     await pluginState.sendGroupText(groupId, '指令已更新，请使用：精确问XX答YY / 模糊问XX答YY');
     return true;
  }
  if (text.startsWith('删除问答 ')) {
    if (!pluginState.isOwner(userId) && !await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const keyword = text.slice(5).trim();
    if (!keyword) { await pluginState.sendGroupText(groupId, '请指定关键词：删除问答 关键词'); return true; }
    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    if (isGroupCustom) {
      const gs = pluginState.config.groups[groupId];
      const before = (gs.qaList || []).length;
      gs.qaList = (gs.qaList || []).filter(q => q.keyword !== keyword);
      if (gs.qaList.length === before) { await pluginState.sendGroupText(groupId, `未找到问答：${keyword}`); return true; }
    } else {
      const before = (pluginState.config.qaList || []).length;
      pluginState.config.qaList = (pluginState.config.qaList || []).filter(q => q.keyword !== keyword);
      if (pluginState.config.qaList.length === before) { await pluginState.sendGroupText(groupId, `未找到问答：${keyword}`); return true; }
    }
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已删除问答：${keyword}`);
    return true;
  }

  // ===== 活跃统计 =====
  if (text.startsWith('活跃统计')) {
    if (pluginState.getGroupSettings(groupId).disableActivity) { await pluginState.sendGroupText(groupId, '本群活跃统计已关闭'); return true; }
    if (!authManager.checkFeature(groupId, 'analytics_detail')) { await pluginState.sendGroupText(groupId, '活跃统计仅限专业版/企业版使用，请购买授权。'); return true; }
    
    const stats = await dbQuery.getAllActivity(groupId);
    if (!Object.keys(stats).length) { await pluginState.sendGroupText(groupId, '本群暂无活跃统计数据'); return true; }
    
    const selfId = String((event as any).self_id || '');
    const entries = Object.entries(stats).sort((a, b) => b[1].msgCount - a[1].msgCount);
    const today = new Date().toISOString().slice(0, 10);
    const totalMsg = entries.reduce((s, [, r]) => s + r.msgCount, 0);
    const todayMsg = entries.reduce((s, [, r]) => s + (r.lastActiveDay === today ? r.msgCountToday : 0), 0);
    const summary = `📊 本群活跃统计\n总消息数：${totalMsg}\n今日消息：${todayMsg}\n统计人数：${entries.length}`;
    
    // 分页，每页15人
    const pages: string[] = [];
    const pageSize = 15;
    for (let i = 0; i < entries.length; i += pageSize) {
      const chunk = entries.slice(i, i + pageSize);
      const lines = chunk.map(([uid, r], idx) => {
        const rank = i + idx + 1;
        const todayC = r.lastActiveDay === today ? r.msgCountToday : 0;
        const lastTime = new Date(r.lastActive).toLocaleString('zh-CN', { hour12: false });
        return `${rank}. ${uid}\n   总消息：${r.msgCount} | 今日：${todayC}\n   最后活跃：${lastTime}`;
      });
      pages.push(`排行榜（${i + 1}-${i + chunk.length}）\n\n${lines.join('\n\n')}`);
    }
    const nodes = [summary, ...pages].map(content => ({
      type: 'node', data: { nickname: '📊 活跃统计', user_id: selfId, content: [{ type: 'text', data: { text: content } }] },
    }));
    await pluginState.callApi('send_group_forward_msg', { group_id: groupId, messages: nodes });
    return true;
  }

  // ===== 更多开关 (入群/自动审批/刷屏/退群拉黑/二维码/媒体过滤) =====
  if (text === '开启入群验证') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].enableVerify = true;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启入群验证');
    return true;
  }
  if (text === '关闭入群验证') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].enableVerify = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭入群验证');
    return true;
  }

  if (text === '开启自动审批') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].autoApprove = true;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启自动审批');
    return true;
  }
  if (text === '关闭自动审批') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].autoApprove = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭自动审批');
    return true;
  }

  if (text === '开启刷屏检测') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].spamDetect = true;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启刷屏检测');
    return true;
  }
  if (text === '关闭刷屏检测') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].spamDetect = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭刷屏检测');
    return true;
  }

  if (text === '开启退群拉黑') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].leaveBlacklist = true;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启退群拉黑');
    return true;
  }
  if (text === '关闭退群拉黑') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].leaveBlacklist = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭退群拉黑');
    return true;
  }

  if (text === '开启二维码撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    if (!pluginState.config.groups[groupId].msgFilter) pluginState.config.groups[groupId].msgFilter = { ...pluginState.config.global.msgFilter };
    pluginState.config.groups[groupId].msgFilter!.blockQr = true;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启二维码撤回');
    return true;
  }
  if (text === '关闭二维码撤回') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (pluginState.config.groups[groupId]) {
        if (!pluginState.config.groups[groupId].msgFilter) pluginState.config.groups[groupId].msgFilter = { ...pluginState.config.global.msgFilter };
        pluginState.config.groups[groupId].msgFilter!.blockQr = false;
        saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, '已关闭二维码撤回');
    return true;
  }

  return false;
}

/** 处理撤回（针对/黑名单/违禁词/刷屏） */
export async function handleAntiRecall (groupId: string, messageId: string, operatorId: string): Promise<void> {
  // 不处理自己撤回
  if (operatorId === pluginState.botId) return;

  // 1. 检查是否开启防撤回
  if (!pluginState.config.antiRecallGroups.includes(groupId) && !pluginState.config.globalAntiRecall) return;

  // 2. 查找消息缓存
  const cached = pluginState.msgCache.get(messageId);
  if (!cached) return;

  // 3. 重新发送
  const contentSegments = cached.segments.length ? cached.segments : [{ type: 'text', data: { text: cached.raw } }];
  
  // 加上提示
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const owners = pluginState.config.ownerQQs.split(',').map(s => s.trim()).filter(Boolean);
  for (const owner of owners) {
    await pluginState.callApi('send_private_msg', {
      user_id: owner,
      message: [
        { type: 'text', data: { text: `🔔 防撤回通知\n群号：${groupId}\nQQ号：${cached.userId}\n时间：${timeStr}\n撤回内容：\n` } },
        ...contentSegments,
      ],
    });
  }
}

/** 缓存消息（用于防撤回） */
export function cacheMessage (messageId: string, userId: string, groupId: string, raw: string, segments?: any[]): void {
  if (!pluginState.config.antiRecallGroups.includes(groupId) && !pluginState.config.globalAntiRecall) return;
  pluginState.msgCache.set(messageId, { userId, groupId, raw, segments: segments || [], time: Date.now() });
  const now = Date.now();
  for (const [k, v] of pluginState.msgCache) {
    if (now - v.time > 600000) pluginState.msgCache.delete(k);
  }
}

/** 处理回应表情 */
export async function handleEmojiReact (groupId: string, userId: string, messageId: string, selfId: string): Promise<void> {
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

/** 处理名片锁定检查（事件模式） */
export async function handleCardLockCheck (groupId: string, userId: string): Promise<void> {
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

/** 处理名片锁定检查（消息模式） */
export async function handleCardLockOnMessage (groupId: string, userId: string, senderCard: string): Promise<void> {
  const key = `${groupId}:${userId}`;
  const lockedCard = pluginState.config.cardLocks[key];
  if (lockedCard === undefined) return;
  const currentCard = senderCard || '';
  if (currentCard !== lockedCard) {
    pluginState.log('info', `[MsgCheck] 监测到 ${userId} 名片异常(当前: "${currentCard}", 锁定: "${lockedCard}")，正在修正...`);
    await pluginState.callApi('set_group_card', { group_id: groupId, user_id: userId, card: lockedCard });
  }
}

/** 处理针对用户自动撤回 */
export async function handleAutoRecall (groupId: string, userId: string, messageId: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const targets = settings.targetUsers || [];
  if (!targets.includes(userId)) return false;
  await pluginState.callApi('delete_msg', { message_id: messageId });
  pluginState.debug(`针对撤回: 群 ${groupId} 用户 ${userId} 消息 ${messageId}`);
  return true;
}

/** 发送欢迎消息 */
export async function sendWelcomeMessage (groupId: string, userId: string): Promise<void> {
  const settings = pluginState.getGroupSettings(groupId);
  const tpl = (settings.welcomeMessage !== undefined && settings.welcomeMessage !== '') ? settings.welcomeMessage : (pluginState.config.welcomeMessage || '');
  if (!tpl) return;
  const msg = tpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
  await pluginState.sendGroupMsg(groupId, [
    { type: 'at', data: { qq: userId } },
    { type: 'text', data: { text: ` ${msg}` } },
  ]);
}

/** 处理消息类型过滤（视频/图片/语音/转发/小程序/名片/链接/二维码） */
export async function handleMsgTypeFilter (groupId: string, userId: string, messageId: string, raw: string, messageSegments: any[]): Promise<boolean> {
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

  // 二维码检查 (如果未被图片拦截且开启了二维码拦截)
  if (!blocked && filter.blockQr) {
    const images = messageSegments.filter((s: any) => s.type === 'image');
    for (const img of images) {
        // NapCat/OneBot11 image segment usually has 'url' or 'file'
        const url = img.url || img.file; 
        if (url && (url.startsWith('http') || url.startsWith('file://'))) {
            try {
                const hasQr = await detectQrCode(url);
                if (hasQr) {
                    blocked = true;
                    reason = '二维码';
                    break;
                }
            } catch (e) {
                // ignore
            }
        }
    }
  }

  if (!blocked) return false;
  await pluginState.callApi('delete_msg', { message_id: messageId });
  pluginState.log('info', `消息类型过滤: 群 ${groupId} 用户 ${userId} 发送${reason}，已撤回`);
  return true;
}

/** 黑名单处理 */
export async function handleBlacklist (groupId: string, userId: string, messageId: string): Promise<boolean> {
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

/** 违禁词过滤 */
export async function handleFilterKeywords (groupId: string, userId: string, messageId: string, raw: string, ctx: NapCatPluginContext): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const groupKw = settings.filterKeywords || [];
  const globalKw = pluginState.config.filterKeywords || [];
  const allKw = [...new Set([...groupKw, ...globalKw])];

  if (!allKw.length) return false;

  const matched = allKw.find(k => raw.includes(k));
  if (matched) {
    const masked = matched.length > 1 ? matched[0] + '*'.repeat(matched.length - 1) : '*';
    await pluginState.callApi('delete_msg', { message_id: messageId });
    pluginState.log('info', `违禁词拦截: 群 ${groupId} 用户 ${userId} 触发「${matched}」`);

    // 惩罚机制
    // level 1: 仅撤回
    // level 2: 撤回 + 禁言
    // level 3: 撤回 + 踢出
    // level 4: 撤回 + 拉黑
    const level = settings.filterLevel || 1;

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
  return false;
}

/** 处理刷屏检测（频率 + 复读） */
export async function handleSpamDetect (groupId: string, userId: string, raw: string = ''): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  const spamOn = settings.spamDetect !== undefined ? settings.spamDetect : pluginState.config.spamDetect;
  if (!spamOn) return false;
  const windowMs = ((settings.spamWindow !== undefined ? settings.spamWindow : pluginState.config.spamWindow) || 10) * 1000;
  const threshold = (settings.spamThreshold !== undefined ? settings.spamThreshold : pluginState.config.spamThreshold) || 10;
  const key = `${groupId}:${userId}`;
  const now = Date.now();

  // 1. 频率检测
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

  // 2. 复读检测 (新增)
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

/** 问答自动回复 */
export async function handleQA (groupId: string, userId: string, raw: string): Promise<boolean> {
  const settings = pluginState.getGroupSettings(groupId);
  // 检查是否开启问答功能（新增开关）
  if (settings.disableQA) return false;

  const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
  const qaList = isGroupCustom ? (settings.qaList || []) : (pluginState.config.qaList || []);
  if (!qaList.length) return false;

  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  for (const qa of qaList) {
    let matched = false;
    if (qa.mode === 'exact') matched = text === qa.keyword;
    else if (qa.mode === 'contains') matched = text.includes(qa.keyword);
    else if (qa.mode === 'regex') { try { matched = new RegExp(qa.keyword).test(text); } catch { /* ignore */ } }
    if (matched) {
      const reply = qa.reply.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId);
      // 修复：如果回复包含 CQ 码（如图片），需要解析发送
      if (reply.includes('[CQ:')) {
         // 简单处理：作为纯文本发送，OneBot 11 实现通常会自动解析 text 中的 CQ 码
         // 但更稳妥的方式是构造 message array，这里 NapCat 支持直接发送含 CQ 码的字符串
         await pluginState.sendGroupMsg(groupId, [{ type: 'text', data: { text: reply } }]);
      } else {
         await pluginState.sendGroupText(groupId, reply);
      }
      pluginState.debug(`问答触发: 群 ${groupId} 用户 ${userId} 匹配 [${qa.mode}]${qa.keyword}`);
      return true;
    }
  }
  return false;
}

/** 记录活跃统计 */
export async function recordActivity(groupId: string, userId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    
    let activity = await dbQuery.getActivityAsync(groupId, userId);
    if (!activity) {
        activity = {
            msgCount: 0,
            lastActive: 0,
            role: 'member', 
            msgCountToday: 0,
            lastActiveDay: today
        };
    }
    
    activity.msgCount++;
    activity.lastActive = now;
    
    if (activity.lastActiveDay !== today) {
        activity.lastActiveDay = today;
        activity.msgCountToday = 1;
    } else {
        activity.msgCountToday++;
    }
    
    await dbQuery.updateActivity(groupId, userId, activity);
}