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
      
      // 2. 保存分群配置到 data/groups/{gid}/
      const dataDir = path.join(path.dirname(ctx.configPath), 'data');
      const groupsDir = path.join(dataDir, 'groups');
      if (!fs.existsSync(groupsDir)) fs.mkdirSync(groupsDir, { recursive: true });
      
      for (const [gid, cfg] of Object.entries(pluginState.config.groups)) {
        if (cfg) {
          const groupDir = path.join(groupsDir, gid);
          if (!fs.existsSync(groupDir)) fs.mkdirSync(groupDir, { recursive: true });
          
          // 分离 QA 数据
          const qaList = cfg.qaList || [];
          const configToSave = { ...cfg };
          delete configToSave.qaList;
          
          // 保存 config.json
          fs.writeFileSync(path.join(groupDir, 'config.json'), JSON.stringify(configToSave, null, 2), 'utf-8');
          
          // 保存 qa.json
          fs.writeFileSync(path.join(groupDir, 'qa.json'), JSON.stringify(qaList, null, 2), 'utf-8');
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
    const isOwner = pluginState.isOwner(userId);
    if (!isOwner) {
        pluginState.log('warn', `非主人用户 ${userId} 尝试执行私聊管理指令 [${text}] 被拦截`);
        await pluginState.sendPrivateMsg(userId, '权限不足：该指令仅限机器人主人使用。');
        return true; // 返回 true 表示已处理（拦截），不再继续
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
      
      if (text === '开启调试') {
          pluginState.config.debug = true;
          saveConfig(ctx);
          await pluginState.sendPrivateMsg(userId, '调试模式已开启');
          return true;
      }
      if (text === '关闭调试') {
          pluginState.config.debug = false;
          saveConfig(ctx);
          await pluginState.sendPrivateMsg(userId, '调试模式已关闭');
          return true;
      }

      // ===== 全局风控指令 (仅限主人私聊) =====
      if (text === '开启随机后缀') {
          pluginState.config.global.randomSuffix = true;
          saveConfig(ctx);
          await pluginState.sendPrivateMsg(userId, '全局随机后缀已开启');
          return true;
      }
      if (text === '关闭随机后缀') {
          pluginState.config.global.randomSuffix = false;
          saveConfig(ctx);
          await pluginState.sendPrivateMsg(userId, '全局随机后缀已关闭');
          return true;
      }
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
      if (text === '开启全局自身撤回') {
          pluginState.config.global.autoRecallSelf = true;
          saveConfig(ctx);
          await pluginState.sendPrivateMsg(userId, '全局自身撤回已开启');
          return true;
      }
      if (text === '关闭全局自身撤回') {
          pluginState.config.global.autoRecallSelf = false;
          saveConfig(ctx);
          await pluginState.sendPrivateMsg(userId, '全局自身撤回已关闭');
          return true;
      }

      // ===== 多群广播 (仅限主人私聊) =====
      if (text.startsWith('多群广播 ')) {
          const content = text.slice(5).trim();
          if (!content) { await pluginState.sendPrivateMsg(userId, '请输入广播内容'); return true; }
          
          await pluginState.sendPrivateMsg(userId, '开始广播，请稍候...');
          
          // 获取所有群列表
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
              // 跳过未授权群 (可选，这里假设广播是给所有已连接群的通知，或者仅给授权群？为了安全，仅给授权群广播)
              const license = authManager.getGroupLicense(gid);
              if (!license) continue;
              
              try {
                  await pluginState.sendGroupText(gid, `【全员通知】\n${content}`);
                  success++;
                  // 延时防风控 (1-2秒)
                  await new Promise(r => setTimeout(r, 1500));
              } catch {
                  fail++;
              }
          }
          
          await pluginState.sendPrivateMsg(userId, `广播完成。\n成功: ${success}\n失败: ${fail}`);
          return true;
      }

      // 未匹配到任何指令
      pluginState.log('warn', `主人私聊发送了未知指令: [${text}]`);
      await pluginState.sendPrivateMsg(userId, `未知指令: ${text}\n请发送“菜单”查看可用指令。`);
      return true;

    } catch (e) {
      pluginState.log('error', `处理私聊指令出错: ${e}`);
      await pluginState.sendPrivateMsg(userId, `指令执行出错: ${e}`);
      return true;
    }
  }

  const groupId = String(event.group_id);

  // 允许所有群成员查询授权状态 (无论是否已授权)
  if (text === '查询授权' || text === '授权状态') {
      const license = authManager.getGroupLicense(groupId);
      if (!license) {
          await pluginState.sendGroupText(groupId, '⚠️ 本群当前未获得授权\n功能受限，请联系管理员获取授权。');
      } else {
          const remaining = license.expireTime === -1 ? '永久' : Math.ceil((license.expireTime - Date.now()) / 86400000) + '天';
          await pluginState.sendGroupText(groupId, `✅ 本群已授权 (${license.level === 'enterprise' ? '企业版' : '专业版'})\n📅 剩余有效期: ${remaining}`);
      }
      return true;
  }

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

  // ===== 功能开关 (互动/验证/管理) =====
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

  // ===== 入群暗号设置 =====
  if (text.startsWith('设置暗号 ')) {
      if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
      const passphrase = text.slice(5).trim();
      
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      const gs = pluginState.config.groups[groupId];
      
      if (passphrase === '关闭' || passphrase === '无') {
          gs.entryPassphrase = '';
          await pluginState.sendGroupText(groupId, '已关闭入群暗号验证');
      } else {
          gs.entryPassphrase = passphrase;
          await pluginState.sendGroupText(groupId, `已设置入群暗号为：${passphrase}`);
      }
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, `已设置入群暗号为：${passphrase}`);
      return true;
  }
  
  // ===== 刷屏与复读检测 =====
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

  // ===== 消息过滤开关 =====
  if (text.startsWith('屏蔽 ') || text.startsWith('取消屏蔽 ')) {
      if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
      const isBlock = text.startsWith('屏蔽 ');
      const type = text.slice(isBlock ? 3 : 5).trim();
      
      if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
      const gs = pluginState.config.groups[groupId];
      if (!gs.msgFilter) gs.msgFilter = { ...pluginState.config.global.msgFilter }; // 初始化
      
      switch (type) {
          case '图片': gs.msgFilter.blockImage = isBlock; break;
          case '视频': gs.msgFilter.blockVideo = isBlock; break;
          case '语音': gs.msgFilter.blockRecord = isBlock; break;
          case '链接': gs.msgFilter.blockUrl = isBlock; break;
          case '二维码': gs.msgFilter.blockQr = isBlock; break;
          case '名片': gs.msgFilter.blockContact = isBlock; break;
          case '小程序': gs.msgFilter.blockLightApp = isBlock; break;
          case '转发': gs.msgFilter.blockForward = isBlock; break;
          default:
              await pluginState.sendGroupText(groupId, '未知类型。支持：图片、视频、语音、链接、二维码、名片、小程序、转发');
              return true;
      }
      saveConfig(ctx);
      await pluginState.sendGroupText(groupId, `已${isBlock ? '屏蔽' : '取消屏蔽'}：${type}`);
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

  // ===== LOL封号查询 =====
  if (text.startsWith('查封号')) {
      const rest = text.slice(3).trim();
      let targetQQ = rest;
      
      // 如果没有直接提供纯数字QQ号，尝试从消息中提取（支持@和文本包含）
      if (!targetQQ || !/^\d+$/.test(targetQQ)) {
          targetQQ = getTarget(raw, rest) || '';
      }
      
      if (!targetQQ) {
          await pluginState.sendGroupText(groupId, '请指定要查询的QQ号，例如：查封号 12345 或 查封号 @某人');
          return true;
      }
      
      // 简单的格式校验
      if (!/^\d{5,13}$/.test(targetQQ)) {
          await pluginState.sendGroupText(groupId, 'QQ号格式错误 (需5-13位数字)');
          return true;
      }
      
      try {
          const apiUrl = `https://yun.4png.com/api/query.html?token=c7739372694acf36&qq=${targetQQ}`;
          const response = await fetch(apiUrl);
          const data = await response.json();
          const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
          const banTexts = [
            '真是活该，直接进小黑屋了~',
            '这波操作属实离谱，封得明明白白。',
            '翻车现场，系统都看不下去了。',
            '号子已经躺平，连申诉都得排队。',
            '风控一锤定音，这把寄得很彻底。',
            '这号现在主打一个“只能看不能玩”。'
          ];
          const safeTexts = [
            '安全着呢，稳得一批~',
            '状态健康，今天也没翻车。',
            '干净得很，风控都点了个赞。',
            '目前稳如老狗，继续保持。',
            '状态在线，暂时没有危险信号。',
            '看起来很平安，继续低调上分吧。'
          ];
          const unknownTexts = [
            '接口今天有点小情绪，稍后再查一次。',
            '这波网络不太给面子，过会儿再试试。',
            '数据源在摸鱼，建议晚点重试。',
            '查询通道有点拥挤，等等会更稳。'
          ];
          const sendResult = async (content: string) => {
            await pluginState.sendGroupMsg(groupId, [
              { type: 'at', data: { qq: userId } },
              { type: 'text', data: { text: ` 查询的 QQ:${targetQQ}，${content}` } }
            ]);
          };
          
          if (data.code === 200) {
             const statusText = `${data.msg || ''} ${data.data?.banmsg || ''}`;
             const normalized = statusText.replace(/\s+/g, '');
             const unbanned = /未封|正常|安全|无封|未被封|无处罚/.test(normalized);
             const banned = /封|ban|冻结|停封|处罚|禁赛/.test(normalized) && !unbanned;
             if (banned) {
               await sendResult(`这号被封了，${pick(banTexts)}`);
             } else {
               await sendResult(`这号未封，${pick(safeTexts)}`);
             }
          } else if (data.code === 404) {
             await sendResult(`这号未封，暂未查到封禁记录，${pick(safeTexts)}`);
          } else if (data.code === 403) {
             await sendResult(`暂时无法确认是否封号（403），${pick(unknownTexts)}`);
          } else if (data.code === 429) {
             await sendResult(`暂时无法确认是否封号（429），${pick(unknownTexts)}`);
          } else {
             await sendResult(`暂时无法确认是否封号（${data.code || '未知状态'}），${pick(unknownTexts)}`);
          }
      } catch (e: any) {
          pluginState.log('error', `查询封号失败: ${e}`);
          const unknownTexts = [
            '接口今天有点小情绪，稍后再查一次。',
            '这波网络不太给面子，过会儿再试试。',
            '数据源在摸鱼，建议晚点重试。',
            '查询通道有点拥挤，等等会更稳。'
          ];
          const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
          await pluginState.sendGroupMsg(groupId, [
            { type: 'at', data: { qq: userId } },
            { type: 'text', data: { text: ` 查询的 QQ:${targetQQ}，暂时无法确认是否封号，${pick(unknownTexts)}` } }
          ]);
      }
      return true;
  }

  // ===== LOL隐藏战绩查询配置 =====
  if (text.startsWith('设置lolurl')) {
    if (!pluginState.isOwner(userId)) { return true; }
    const url = text.replace('设置lolurl', '').trim();
    if (!url) {
        await pluginState.sendGroupText(groupId, '请提供完整的查询接口地址，例如：设置lolurl http://example.com/query.php');
        return true;
    }
    pluginState.config.lolQueryUrl = url;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '自定义战绩查询接口地址已更新');
    return true;
  }

  if (text.startsWith('设置lolkey')) {
    if (!pluginState.isOwner(userId)) { return true; }
    const key = text.replace('设置lolkey', '').trim();
    if (!key) {
        await pluginState.sendGroupText(groupId, '请提供授权码(zhanjikey)');
        return true;
    }
    pluginState.config.lolAuthKey = key;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '自定义战绩查询授权码已更新');
    return true;
  }

  if (text.startsWith('设置loltoken')) {
    if (!pluginState.isOwner(userId)) { return true; } // 仅主人可见
    const token = text.replace('设置loltoken', '').trim();
    if (!token) {
        await pluginState.sendGroupText(groupId, '请提供 Token，例如：设置loltoken eyJ...');
        return true;
    }
    pluginState.config.lolToken = token;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, 'LOL Token 已更新');
    return true;
  }

  // ===== LOL隐藏战绩查询 =====
  if (text.startsWith('查隐藏')) {
      const rest = text.replace('查隐藏', '').trim();
      if (!rest) {
          await pluginState.sendGroupText(groupId, '请指定召唤师名称，例如：查隐藏 TheShy');
          return true;
      }
      
      const args = rest.split(/\s+/);
      const name = args[0];
      const region = args[1] || '1'; // 默认大区1

      // 优先检查是否配置了自定义查询接口
      const customUrl = pluginState.config.lolQueryUrl;
      const customKey = pluginState.config.lolAuthKey;

      if (customUrl && customKey) {
          await pluginState.sendGroupText(groupId, `🔍 正在通过自定义接口查询 ${name}...`);
          try {
             // 构造表单数据
             const params = new URLSearchParams();
             params.append('name', name);
             params.append('region', region);
             params.append('sign', '0'); // 默认尝试 0，如果失败可能需要逆向 sign 算法
             params.append('key', customKey);

             const res = await fetch(customUrl, {
                 method: 'POST',
                 body: params,
                 headers: {
                     'Content-Type': 'application/x-www-form-urlencoded',
                     'X-Requested-With': 'XMLHttpRequest',
                     'Cookie': `zhanjikey=${customKey}`,
                     'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                 }
             });

             if (res.status === 200) {
                 const json: any = await res.json();
                 if (json.status === 200) {
                     const d = json.data;
                     let msg = `📊 ${d.summonerName} (Lv.${d.level}) 隐藏战绩\n`;
                     msg += `------------------------------\n`;
                     msg += `封号状态: ${d.banstatus === 1 ? '❌ 封号' : (d.banstatus === 2 ? '❓ 未知/灰白' : '✅ 正常')}\n`;
                     if (d.banst) msg += `封号详情: ${d.banst}\n`;
                     msg += `单双排: ${d.soloData?.tier} ${d.soloData?.rank} (${d.soloData?.lp}点)\n`;
                     msg += `灵活排: ${d.flexData?.tier} ${d.flexData?.rank} (${d.flexData?.lp}点)\n`;
                     msg += `最后在线: ${d.last_game?.time || '未知'}\n`;
                     msg += `排位资格: ${d.rankEligibility || '未知'}`;
                     
                     await pluginState.sendGroupText(groupId, msg);
                     return true;
                 } else {
                     await pluginState.sendGroupText(groupId, `查询失败: ${json.msg || '未知错误'}`);
                     return true;
                 }
             } else {
                 await pluginState.sendGroupText(groupId, `接口请求失败: HTTP ${res.status}`);
                 return true;
             }
          } catch (e: any) {
              pluginState.log('error', `自定义查询出错: ${e}`);
              await pluginState.sendGroupText(groupId, `查询出错: ${e.message}`);
              return true;
          }
      }
      
      const token = pluginState.config.lolToken;
      if (!token) {
          await pluginState.sendGroupText(groupId, '❌ 未配置 LOL Token，请联系机器人主人配置');
          return true;
      }

      await pluginState.sendGroupText(groupId, `🔍 正在查询 [${region}区] ${name} 的隐藏战绩...`);
      
      try {
          // Step 1: Search Summoner
          const searchUrl = `https://ww1.lolso1.com/game-lol/customize-summoner-basic-by-name-region`;
          const headers = {
              'Authorization': `Bearer ${token}`,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Content-Type': 'application/json',
              'Referer': 'https://lolso1.com/',
              'Origin': 'https://lolso1.com'
          };
          
          const searchRes = await fetch(searchUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({ name, region: parseInt(region) || 1 })
          });
          
          if (!searchRes.ok) {
              const errText = await searchRes.text();
              if (searchRes.status === 403 || searchRes.status === 405) {
                   await pluginState.sendGroupText(groupId, `🛑 查询被拦截 [${searchRes.status}]：API 拒绝访问 (可能是WAF或Token无效)`);
              } else {
                   await pluginState.sendGroupText(groupId, `❌ 搜索失败 [${searchRes.status}]`);
              }
              pluginState.log('error', `LOL Search Failed: ${searchRes.status} ${errText}`);
              return true;
          }
          
          const searchData: any = await searchRes.json();
          if (!searchData.data || !searchData.data.puuid) {
              await pluginState.sendGroupText(groupId, `❌ 未找到召唤师 ${name}`);
              return true;
          }
          
          const { puuid, summonerLevel } = searchData.data;
          
          // Step 2: Get Match History
          const historyUrl = `https://ww1.lolso1.com/game-lol/customize-normal-match-history-simplified`;
          const historyRes = await fetch(historyUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                  puuid,
                  region: parseInt(region) || 1,
                  start: 0,
                  count: 5
              })
          });
          
          if (!historyRes.ok) {
              await pluginState.sendGroupText(groupId, `❌ 获取战绩失败 [${historyRes.status}]`);
              return true;
          }
          
          const historyData: any = await historyRes.json();
          const matches = historyData.data || [];
          
          if (matches.length === 0) {
              await pluginState.sendGroupText(groupId, `📭 ${name} 最近没有比赛记录`);
              return true;
          }
          
          let msg = `📊 ${name} (Lv.${summonerLevel}) 近5场战绩：\n`;
          msg += `------------------------------\n`;
          
          for (const match of matches) {
              const mode = match.queueId === 420 ? '排位' : (match.queueId === 450 ? '乱斗' : '匹配');
              const result = match.win ? '✅ 胜利' : '❌ 失败';
              const kda = `${match.kills}/${match.deaths}/${match.assists}`;
              const champion = match.championName || '未知英雄';
              const time = new Date(match.gameEndTimestamp).toLocaleString();
              
              msg += `${result} | ${champion} (${mode})\n`;
              msg += `⚔️ KDA: ${kda}\n`;
              msg += `⏰ ${time}\n`;
              msg += `------------------------------\n`;
          }
          
          await pluginState.sendGroupText(groupId, msg.trim());

      } catch (e: any) {
          pluginState.log('error', `查询隐藏战绩失败: ${e}`);
          await pluginState.sendGroupText(groupId, `查询出错: ${e.message || e}`);
      }
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
  
  // ===== 积分商城 =====
  if (text === '积分商城' || text === '商城') {
      if (pluginState.getGroupSettings(groupId).disableLottery) { await pluginState.sendGroupText(groupId, '本群积分功能已关闭'); return true; }
      
      const menu = `🛒 积分商城
----------------
1. 免死金牌 (清除警告) - 100积分
   指令：兑换 免死金牌
2. 自定义头衔 (永久) - 500积分
   指令：兑换 头衔 <内容>
3. 解除禁言 (自己) - 200积分
   指令：兑换 解禁
----------------
发送“我的积分”查看余额`;
      await pluginState.sendGroupText(groupId, menu);
      return true;
  }

  if (text.startsWith('兑换 ')) {
      if (pluginState.getGroupSettings(groupId).disableLottery) { return true; }
      
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
          await dbQuery.updateSignin(groupId, userId, userSignin);
          await dbQuery.setWarning(groupId, userId, 0);
          await pluginState.sendGroupText(groupId, `兑换成功！已清除所有警告记录。\n剩余积分：${userSignin.points}`);
          return true;
      }
      
      if (item === '头衔') {
          const cost = 500;
          if (userSignin.points < cost) { await pluginState.sendGroupText(groupId, `积分不足，需要 ${cost} 积分`); return true; }
          if (!param) { await pluginState.sendGroupText(groupId, '请指定头衔内容：兑换 头衔 <内容>'); return true; }
          
          // 检查机器人权限
          if (!await pluginState.isBotAdmin(groupId)) { await pluginState.sendGroupText(groupId, '兑换失败：机器人非管理员，无法设置头衔'); return true; }
          
          userSignin.points -= cost;
          await dbQuery.updateSignin(groupId, userId, userSignin);
          await pluginState.callApi('set_group_special_title', { group_id: groupId, user_id: userId, special_title: param });
          await pluginState.sendGroupText(groupId, `兑换成功！头衔已设置为：${param}\n剩余积分：${userSignin.points}`);
          return true;
      }
      
      if (item === '解禁') {
          const cost = 200;
          // 注意：被禁言后无法发送消息，除非是私聊机器人或在其他未禁言群操作（跨群操作暂不支持，这里假设用户刚解禁想买个防身，或者通过临时会话？）
          // 实际上被禁言无法发群消息。这个功能只能是“预防”或者“通过私聊触发（需支持私聊路由到群）”。
          // 由于 handleCommand 目前逻辑：私聊只能主人用，群聊才能触发群功能。
          // 所以这个“兑换 解禁”在群里发出来的前提是没被禁言... 逻辑有点悖论。
          // 除非是“解除刚才的误封”或者“帮别人解禁”？
          // 改为“帮解禁”：兑换 解禁 @某人
          
          const target = getTarget(raw, param) || userId; // 默认为自己
          if (userSignin.points < cost) { await pluginState.sendGroupText(groupId, `积分不足，需要 ${cost} 积分`); return true; }
          
          // 检查机器人权限
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
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词：添加违禁词 词语'); return true; }
    
    // 初始化群配置
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.filterKeywords) gs.filterKeywords = [];
    
    if (!gs.filterKeywords.includes(word)) { 
        gs.filterKeywords.push(word); 
        saveConfig(ctx); 
    }
    await pluginState.sendGroupText(groupId, `已将「${word}」加入本群违禁词`);
    return true;
  }
  if (text.startsWith('添加全局违禁词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(7).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词'); return true; }
    if (!pluginState.config.filterKeywords) pluginState.config.filterKeywords = [];
    if (!pluginState.config.filterKeywords.includes(word)) { pluginState.config.filterKeywords.push(word); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已将「${word}」加入全局违禁词`);
    return true;
  }

  if (text.startsWith('删除违禁词')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词'); return true; }
    
    if (pluginState.config.groups[groupId]) {
        const gs = pluginState.config.groups[groupId];
        if (gs.filterKeywords) {
            gs.filterKeywords = gs.filterKeywords.filter(w => w !== word);
            saveConfig(ctx);
        }
    }
    await pluginState.sendGroupText(groupId, `已从本群违禁词中移除：${word}`);
    return true;
  }
  if (text.startsWith('删除全局违禁词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(7).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定违禁词'); return true; }
    pluginState.config.filterKeywords = (pluginState.config.filterKeywords || []).filter(w => w !== word);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已从全局违禁词中移除：${word}`);
    return true;
  }

  // ===== 违禁词惩罚设置 =====
  if (text.startsWith('设置违禁词惩罚 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const level = parseInt(text.slice(8).trim());
    if (isNaN(level) || level < 1 || level > 4) { 
        await pluginState.sendGroupText(groupId, '请输入有效的惩罚等级 (1-4)：\n1: 仅撤回\n2: 撤回+禁言\n3: 撤回+踢出\n4: 撤回+踢出+拉黑'); 
        return true; 
    }
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].filterPunishLevel = level;
    saveConfig(ctx);
    
    const desc = ['仅撤回', '撤回+禁言', '撤回+踢出', '撤回+踢出+拉黑'][level - 1];
    await pluginState.sendGroupText(groupId, `已设置违禁词惩罚等级为：${level} (${desc})`);
    return true;
  }

  if (text.startsWith('设置违禁词禁言 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const minutes = parseInt(text.slice(8).trim());
    if (isNaN(minutes) || minutes < 1) { await pluginState.sendGroupText(groupId, '请输入有效的禁言时长（分钟）'); return true; }
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].filterBanMinutes = minutes;
    saveConfig(ctx);
    
    await pluginState.sendGroupText(groupId, `已设置违禁词禁言时长为：${minutes} 分钟`);
    return true;
  }

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

  // ===== 入群审核拒绝关键词 =====
  if (text.startsWith('添加拒绝词')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词：添加拒绝词 词语'); return true; }
    
    // 初始化群配置
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    const gs = pluginState.config.groups[groupId];
    if (!gs.rejectKeywords) gs.rejectKeywords = [];
    
    if (!gs.rejectKeywords.includes(word)) { 
        gs.rejectKeywords.push(word); 
        saveConfig(ctx); 
    }
    await pluginState.sendGroupText(groupId, `已将「${word}」加入本群入群拒绝词`);
    return true;
  }
  if (text.startsWith('添加全局拒绝词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(7).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }
    if (!pluginState.config.rejectKeywords) pluginState.config.rejectKeywords = [];
    if (!pluginState.config.rejectKeywords.includes(word)) { pluginState.config.rejectKeywords.push(word); saveConfig(ctx); }
    await pluginState.sendGroupText(groupId, `已将「${word}」加入全局入群拒绝词`);
    return true;
  }

  if (text.startsWith('删除拒绝词')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const word = text.slice(5).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }
    
    if (pluginState.config.groups[groupId]) {
        const gs = pluginState.config.groups[groupId];
        if (gs.rejectKeywords) {
            gs.rejectKeywords = gs.rejectKeywords.filter(w => w !== word);
            saveConfig(ctx);
        }
    }
    await pluginState.sendGroupText(groupId, `已从本群入群拒绝词中移除：${word}`);
    return true;
  }
  if (text.startsWith('删除全局拒绝词')) {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '需要主人权限'); return true; }
    const word = text.slice(7).trim();
    if (!word) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }
    pluginState.config.rejectKeywords = (pluginState.config.rejectKeywords || []).filter(w => w !== word);
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已从全局入群拒绝词中移除：${word}`);
    return true;
  }

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
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    
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
      if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
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

  if (text.startsWith('删除问答 ') || text.startsWith('删问')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    
    const prefix = text.startsWith('删问') ? '删问' : '删除问答 ';
    const keyword = text.slice(prefix.length).trim();
    if (!keyword) { await pluginState.sendGroupText(groupId, '请指定关键词'); return true; }

    const isGroupCustom = pluginState.config.groups[groupId] && !pluginState.config.groups[groupId].useGlobal;
    if (isGroupCustom) {
        const gs = pluginState.config.groups[groupId];
        if (gs.qaList) {
            const before = gs.qaList.length;
            gs.qaList = gs.qaList.filter(q => q.keyword !== keyword);
            if (gs.qaList.length === before) {
                 await pluginState.sendGroupText(groupId, `未找到问答：${keyword}`);
            } else {
                 saveConfig(ctx);
                 await pluginState.sendGroupText(groupId, `已删除问答：${keyword}`);
            }
        } else {
            await pluginState.sendGroupText(groupId, `未找到相关问答`);
        }
    } else {
        await pluginState.sendGroupText(groupId, '当前为全局配置模式，无法删除全局问答。请先开启分群独立配置。');
    }
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

  // ===== 刷屏参数设置 =====
  if (text.startsWith('设置刷屏窗口 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const seconds = parseInt(text.slice(7).trim());
    if (isNaN(seconds) || seconds < 1) { await pluginState.sendGroupText(groupId, '请输入有效的秒数 (至少1秒)'); return true; }
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].spamWindow = seconds;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已设置刷屏检测窗口为：${seconds} 秒`);
    return true;
  }

  if (text.startsWith('设置刷屏阈值 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const count = parseInt(text.slice(7).trim());
    if (isNaN(count) || count < 1) { await pluginState.sendGroupText(groupId, '请输入有效的条数 (至少1条)'); return true; }
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].spamThreshold = count;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已设置刷屏检测阈值为：${count} 条`);
    return true;
  }

  if (text.startsWith('设置刷屏禁言 ')) {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    const minutes = parseInt(text.slice(7).trim());
    if (isNaN(minutes) || minutes < 1) { await pluginState.sendGroupText(groupId, '请输入有效的分钟数 (至少1分钟)'); return true; }
    
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].spamBanMinutes = minutes;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, `已设置刷屏禁言时长为：${minutes} 分钟`);
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

  // ===== 商用入群验证指令 =====
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

  if (text === '关闭入群暗号') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (pluginState.config.groups[groupId]) {
        pluginState.config.groups[groupId].entryPassphrase = '';
        saveConfig(ctx);
    }
    await pluginState.sendGroupText(groupId, '已关闭入群暗号');
    return true;
  }

  if (text === '开启暗号回落') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].enableAutoApproveAfterPassphraseOff = true;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已开启暗号回落（关闭暗号后将使用自动同意规则）');
    return true;
  }

  if (text === '关闭暗号回落') {
    if (!await isAdminOrOwner(groupId, userId)) { await pluginState.sendGroupText(groupId, '需要管理员权限'); return true; }
    if (!pluginState.config.groups[groupId]) pluginState.config.groups[groupId] = { ...pluginState.getGroupSettings(groupId) };
    pluginState.config.groups[groupId].enableAutoApproveAfterPassphraseOff = false;
    saveConfig(ctx);
    await pluginState.sendGroupText(groupId, '已关闭暗号回落（关闭暗号后将不再自动处理申请）');
    return true;
  }

  if (text === '清空群配置') {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '此操作仅限机器人主人执行'); return true; }
    // 需要二次确认，这里简单实现：要求输入 "确认清空群配置"
    await pluginState.sendGroupText(groupId, '⚠️ 警告：此操作将清空本群所有配置和数据（包括问答、违禁词、日志等），且不可恢复！\n请发送「确认清空群配置」以执行。');
    return true;
  }

  if (text === '确认清空群配置') {
    if (!pluginState.isOwner(userId)) { await pluginState.sendGroupText(groupId, '此操作仅限机器人主人执行'); return true; }
    
    try {
        const groupDir = path.join(pluginState.configDir, 'data', 'groups', groupId);
        if (fs.existsSync(groupDir)) {
            // 删除整个目录
            fs.rmSync(groupDir, { recursive: true, force: true });
            // 重新创建空目录
            fs.mkdirSync(groupDir, { recursive: true });
        }
        // 清除内存配置
        delete pluginState.config.groups[groupId];
        // 保存主配置
        saveConfig(ctx);
        
        await pluginState.sendGroupText(groupId, '✅ 已清空本群所有配置和数据');
        pluginState.log('warn', `主人 ${userId} 清空了群 ${groupId} 的所有数据`);
    } catch (e) {
        await pluginState.sendGroupText(groupId, `清空失败: ${e}`);
    }
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
  // 简单避免与管理指令冲突：如果消息以“删问”、“模糊问”、“精确问”、“删除问答”开头，则不进行问答匹配
  if (text.startsWith('删问') || text.startsWith('模糊问') || text.startsWith('精确问') || text.startsWith('删除问答')) {
      return false;
  }

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
