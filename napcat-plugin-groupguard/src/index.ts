// NapCat 群管插件
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import fs from 'fs';
import path from 'path';
import type { PluginConfig } from './types';
import { DEFAULT_PLUGIN_CONFIG } from './config';
import { pluginState } from './state';
import { authManager } from './auth';
import { initDB, dbQuery } from './db';
import { createVerifySession, handleVerifyAnswer, clearAllSessions } from './verify';
import {
  handleCommand, handleAntiRecall, cacheMessage, handleEmojiReact,
  handleCardLockCheck, handleCardLockOnMessage, handleAutoRecall,
  handleBlacklist, handleFilterKeywords, handleSpamDetect,
  sendWelcomeMessage, saveConfig, handleMsgTypeFilter, handleQA,
  recordActivity
} from './commands';

export let plugin_config_ui: PluginConfigSchema = [];

// ========== 插件初始化 ==========
const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  Object.assign(pluginState, {
    logger: ctx.logger,
    actions: ctx.actions,
    adapterName: ctx.adapterName,
    networkConfig: ctx.pluginManager.config,
  });
  pluginState.log('info', '群管插件正在初始化...');

  plugin_config_ui = ctx.NapCatConfig.combine(
    ctx.NapCatConfig.html(`
      <div style="padding:16px;background:linear-gradient(135deg,rgba(59,130,246,0.1),rgba(30,41,59,0.1));border:1px solid rgba(59,130,246,0.3);border-radius:12px;margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
          <div style="width:36px;height:36px;background:rgba(59,130,246,0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;">🛡️</div>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:600;">群管插件 v${pluginState.version}</h3>
            <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">napcat-plugin-groupguard</p>
          </div>
        </div>
        <p style="margin:0;font-size:13px;color:#6b7280;">
          请前往 <a href="#" onclick="window.open(window.location.origin+'/plugin/napcat-plugin-groupguard/page/config','_blank');return false;" style="color:#3B82F6;font-weight:600;">WebUI 控制台</a> 进行详细配置。
        </p>
      </div>
    `),
    ctx.NapCatConfig.text('licenseKey', '授权密钥', '', '专业版/企业版授权密钥'),
    ctx.NapCatConfig.text('ownerQQs', '主人QQ号（逗号分隔）', '', '拥有最高权限的QQ号'),
    ctx.NapCatConfig.boolean('debug', '调试模式', false, '显示详细日志'),
  );

  // 设置配置目录
  if (ctx.configPath) {
    pluginState.configDir = path.dirname(ctx.configPath);
    initDB(pluginState.configDir);
  }

  // 加载主配置
  if (fs.existsSync(ctx.configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
      pluginState.config = { ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)), ...raw };
      
      // 迁移旧的分群配置到独立文件
      if (pluginState.config.groups && Object.keys(pluginState.config.groups).length > 0) {
        pluginState.log('info', '正在迁移旧的分群配置...');
        const groupsDir = path.join(pluginState.configDir, 'groups');
        if (!fs.existsSync(groupsDir)) fs.mkdirSync(groupsDir, { recursive: true });
        
        for (const [gid, cfg] of Object.entries(pluginState.config.groups)) {
          fs.writeFileSync(path.join(groupsDir, `${gid}.json`), JSON.stringify(cfg, null, 2), 'utf-8');
        }
        
        // 清空主配置文件中的 groups，减小体积
        pluginState.config.groups = {};
        fs.writeFileSync(ctx.configPath, JSON.stringify(pluginState.config, null, 2), 'utf-8');
        pluginState.log('info', '分群配置迁移完成');
      }
    } catch { /* ignore */ }
  }

  // 初始化授权
  authManager.init();

  // 定时保存任务 (5分钟一次，减少 I/O)
  setInterval(() => {
    saveConfig(ctx);
    // 顺便清理缓存
    if (pluginState.cleanCache) pluginState.cleanCache();
  }, 300000);

  registerRoutes(ctx);

  // 获取机器人QQ号
  try {
    const loginInfo = await ctx.actions.call('get_login_info', {} as never, ctx.adapterName, ctx.pluginManager.config) as { user_id?: number | string; } | undefined;
    pluginState.botId = loginInfo?.user_id ? String(loginInfo.user_id) : '';
    if (pluginState.botId) pluginState.log('info', `机器人QQ: ${pluginState.botId}`);
  } catch { /* ignore */ }

  pluginState.log('info', '群管插件初始化完成');
};

// ========== 路由注册 ==========
function registerRoutes (ctx: NapCatPluginContext): void {
  const router = (ctx as any).router;

  if (router.static) router.static('/webui', 'webui');

  if (router.page) {
    router.page({ path: 'config', title: '群管配置', icon: '🛡️', htmlFile: 'webui/config.html', description: '群管插件配置面板' });
    pluginState.log('info', '插件页面已注册: 群管配置');
  }

  router.getNoAuth('/config', (_req: any, res: any) => {
    // 合并内存中的 groups，确保前端拿到完整数据
    res.json({ code: 0, data: pluginState.config, version: pluginState.version });
  });

  router.postNoAuth('/config', (req: any, res: any) => {
    try {
      const body = req.body || {};
      const newConfig = { ...pluginState.config, ...body };
      
      // 更新内存
      pluginState.config = newConfig;

      if (ctx?.configPath) {
        saveConfig(ctx);
      }
      res.json({ code: 0, message: '配置已保存' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.getNoAuth('/groups', async (_req: any, res: any) => {
    try {
      const result = await ctx.actions.call('get_group_list', {} as never, ctx.adapterName, ctx.pluginManager.config);
      res.json({ code: 0, data: result || [] });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  router.getNoAuth('/sessions', (_req: any, res: any) => {
    const list = Array.from(pluginState.sessions.values()).map(s => ({
      userId: s.userId, groupId: s.groupId, expression: s.expression,
      attempts: s.attempts, maxAttempts: s.maxAttempts, createdAt: s.createdAt,
      remainingMs: Math.max(0, s.createdAt + pluginState.getGroupSettings(s.groupId).verifyTimeout * 1000 - Date.now()),
    }));
    res.json({ code: 0, data: list });
  });

  router.getNoAuth('/logs', (_req: any, res: any) => {
    res.json({ code: 0, data: pluginState.logBuffer });
  });

  router.postNoAuth('/logs/clear', (_req: any, res: any) => {
    pluginState.clearLogs();
    res.json({ code: 0, message: '日志已清除' });
  });

  // 活跃统计 API
  router.getNoAuth('/activity', (req: any, res: any) => {
    const groupId = req.query?.group_id || '';
    const stats = pluginState.activityStats || {};
    if (groupId) {
      res.json({ code: 0, data: stats[groupId] || {} });
    } else {
      res.json({ code: 0, data: stats });
    }
  });

  // 预设配置 API
  router.getNoAuth('/presets', (_req: any, res: any) => {
    res.json({ code: 0, data: pluginState.config.presets || [] });
  });

  router.postNoAuth('/presets', (req: any, res: any) => {
    try {
      pluginState.config.presets = req.body?.presets || [];
      if (ctx?.configPath) {
        const dir = path.dirname(ctx.configPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ctx.configPath, JSON.stringify(pluginState.config, null, 2), 'utf-8');
      }
      res.json({ code: 0, message: '预设已保存' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  pluginState.log('info', 'WebUI 路由已注册');
}

// ========== 配置管理 ==========
export const plugin_get_config = async (): Promise<PluginConfig> => pluginState.config;
export const plugin_set_config = async (ctx: NapCatPluginContext, config: PluginConfig): Promise<void> => {
  pluginState.config = config;
  if (ctx?.configPath) {
    const dir = path.dirname(ctx.configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ctx.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
};

// ========== 插件清理 ==========
const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  pluginState.log('info', '群管插件正在卸载...');
  pluginState.saveActivity();
  clearAllSessions();
};

// ========== 消息处理 ==========
const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  if (event.post_type !== 'message' || event.message_type !== 'group') return;

  const groupId = String(event.group_id);
  const userId = String(event.user_id);
  const raw = event.raw_message || '';
  const messageId = String(event.message_id);
  const selfId = String((event as any).self_id || '');
  const messageSegments = (event as any).message || [];

  // 0. 授权检查：未授权群完全静默，不处理任何群内指令或被动功能
  const license = authManager.getGroupLicense(groupId);
  if (!license) {
    return;
  }

  // 0.1 自身消息处理：如果是机器人自己发的消息，跳过大部分检查，仅处理撤回
  if (userId === selfId) {
    // 自身消息撤回逻辑
    const settings = pluginState.getGroupSettings(groupId);
    if (settings.autoRecallSelf) {
      const delay = (settings.autoRecallSelfDelay || 60) * 1000;
      setTimeout(() => {
        pluginState.callApi('delete_msg', { message_id: messageId }).catch(() => {});
      }, delay);
    }
    return;
  }

  // 0.2 白名单用户检查
  const isWhite = pluginState.isWhitelisted(userId);

  // 1. 黑名单检查（白名单豁免）
  if (!isWhite) {
    const blacklisted = await handleBlacklist(groupId, userId, messageId);
    if (blacklisted) return;
  }

  // 2. 群管指令处理
  const handled = await handleCommand(event, ctx);
  if (handled) return;

  // 2.5 问答自动回复
  const qaHandled = await handleQA(groupId, userId, raw);
  if (qaHandled) {
    pluginState.recordActivity(groupId, userId);
    cacheMessage(messageId, userId, groupId, raw);
    return;
  }

  // 3. 针对用户自动撤回（白名单豁免）
  if (!isWhite) {
    const recalled = await handleAutoRecall(groupId, userId, messageId);
    if (recalled) return;
  }

  // 4. 违禁词过滤（白名单豁免）
  if (!isWhite) {
    const filtered = await handleFilterKeywords(groupId, userId, messageId, raw, ctx);
    if (filtered) return;
  }

  // 4.5 消息类型过滤（白名单豁免）
  if (!isWhite) {
    const typeFiltered = await handleMsgTypeFilter(groupId, userId, messageId, raw, messageSegments);
    if (typeFiltered) return;
  }

  // 5. 刷屏检测（白名单豁免）
  if (!isWhite) {
    await handleSpamDetect(groupId, userId, raw);
  }

  // 6. 记录活跃统计
  recordActivity(groupId, userId);

  // 7. 缓存消息（防撤回）
  cacheMessage(messageId, userId, groupId, raw, messageSegments);

  // 8. 回应表情
  await handleEmojiReact(groupId, userId, messageId, selfId);

  // 9. 验证答题
  const settings = pluginState.getGroupSettings(groupId);
  if (!settings.enableVerify) return;
  await handleVerifyAnswer(groupId, userId, raw, messageId);
};

// ========== 事件处理 ==========
const plugin_onevent: PluginModule['plugin_onevent'] = async (ctx: NapCatPluginContext, event: unknown) => {
  const e = event as {
    post_type?: string; request_type?: string; notice_type?: string; sub_type?: string;
    group_id?: number | string; user_id?: number | string; operator_id?: number | string;
    message_id?: number | string; card_new?: string; flag?: string; comment?: string;
  };

  const groupId = String(e.group_id);
  // 授权检查：未授权群忽略所有事件
  const license = authManager.getGroupLicense(groupId);
  if (!license && groupId !== 'undefined') return;

  // 入群申请处理
  if (e.post_type === 'request' && e.request_type === 'group' && e.sub_type === 'add') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);

    // 黑名单用户自动拒绝（全局+群独立）
    if (pluginState.isBlacklisted(userId)) {
      pluginState.log('info', `黑名单用户 ${userId} 申请加入群 ${groupId}，自动拒绝（全局黑名单）`);
      if (pluginState.actions && pluginState.networkConfig && e.flag) {
        await pluginState.actions.call('set_group_add_request', {
          flag: e.flag, sub_type: 'add', approve: false, reason: '你已被列入黑名单',
        } as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
      }
      return;
    }
    const joinSettings = pluginState.getGroupSettings(groupId);
    if ((joinSettings.groupBlacklist || []).includes(userId)) {
      pluginState.log('info', `黑名单用户 ${userId} 申请加入群 ${groupId}，自动拒绝（群独立黑名单）`);
      if (pluginState.actions && pluginState.networkConfig && e.flag) {
        await pluginState.actions.call('set_group_add_request', {
          flag: e.flag, sub_type: 'add', approve: false, reason: '你已被列入黑名单',
        } as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
      }
      return;
    }

    const settings = pluginState.getGroupSettings(groupId);
    if (!settings.autoApprove) return;

    // 拒绝关键词检查（群级优先，没有则用全局）
    const rejectKw = (settings.rejectKeywords?.length ? settings.rejectKeywords : pluginState.config.rejectKeywords) || [];
    if (rejectKw.length && e.comment) {
      const commentText = e.comment.replace(/^问题：/, '').replace(/\s*答案：/, ' ');
      const matched = rejectKw.find(k => commentText.includes(k));
      if (matched) {
        pluginState.log('info', `入群审核拒绝: 用户 ${userId} 申请加入群 ${groupId}，验证信息包含拒绝关键词「${matched}」`);
        if (pluginState.actions && pluginState.networkConfig && e.flag) {
          await pluginState.actions.call('set_group_add_request', {
            flag: e.flag, sub_type: 'add', approve: false, reason: `验证信息包含拒绝关键词`,
          } as never, pluginState.adapterName, pluginState.networkConfig).catch(() => { });
        }
        return;
      }
    }

    if (e.comment) pluginState.pendingComments.set(`${groupId}:${userId}`, e.comment);
    pluginState.log('info', `自动通过入群申请: 用户 ${userId} 申请加入群 ${groupId}`);
    if (pluginState.actions && pluginState.networkConfig && e.flag) {
      await pluginState.actions.call('set_group_add_request', {
        flag: e.flag, sub_type: 'add', approve: true,
      } as never, pluginState.adapterName, pluginState.networkConfig).catch(err => {
        pluginState.log('error', `自动通过入群申请失败: ${err}`);
      });
    }
    return;
  }

  // 新成员进群 - 发起验证 + 欢迎词
  if (e.post_type === 'notice' && e.notice_type === 'group_increase') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    const operatorId = String(e.operator_id || '');

    // 邀请统计
    if (operatorId && operatorId !== userId && operatorId !== pluginState.botId) {
      // 检查被邀请人是否已有记录（防止重复刷分）
      const inviteeRecord = dbQuery.getInvite(groupId, userId);
      // 如果没有inviter_id，说明是首次被邀请记录
      if (!inviteeRecord || !inviteeRecord.inviterId) {
          // 1. 更新被邀请人的记录，设置邀请人
          const newInviteeRecord = inviteeRecord || { inviteCount: 0, joinTime: Date.now() };
          newInviteeRecord.inviterId = operatorId;
          dbQuery.updateInvite(groupId, userId, newInviteeRecord);
          
          // 2. 更新邀请人的统计
          let inviterRecord = dbQuery.getInvite(groupId, operatorId);
          if (!inviterRecord) inviterRecord = { inviteCount: 0, joinTime: 0 };
          inviterRecord.inviteCount++;
          dbQuery.updateInvite(groupId, operatorId, inviterRecord);
          
          // 3. 邀请奖励
          const settings = pluginState.getGroupSettings(groupId);
          if (settings.invitePoints && settings.invitePoints > 0) {
              let inviterSignin = dbQuery.getSignin(groupId, operatorId);
              if (!inviterSignin) inviterSignin = { lastSignin: 0, days: 0, points: 0 };
              inviterSignin.points += settings.invitePoints;
              dbQuery.updateSignin(groupId, operatorId, inviterSignin);
              pluginState.log('info', `邀请奖励: 用户 ${operatorId} 邀请 ${userId} 进群，获得 ${settings.invitePoints} 积分`);
          }
      }
    }

    // 跳过机器人自身入群
    if (userId === pluginState.botId) {
      pluginState.log('info', `机器人自身加入群 ${groupId}，跳过验证`);
      return;
    }

    // 检查机器人是否是管理员，非管理员不验证
    const isAdmin = await pluginState.isBotAdmin(groupId);
    if (!isAdmin) {
      pluginState.debug(`机器人在群 ${groupId} 不是管理员，跳过验证`);
      return;
    }

    const settings = pluginState.getGroupSettings(groupId);

    if (!settings.enableVerify) {
      // 不验证，只发欢迎词
      await sendWelcomeMessage(groupId, userId);
      return;
    }
    // 验证模式：欢迎词合并到验证消息里一起发
    const commentKey = `${groupId}:${userId}`;
    const comment = pluginState.pendingComments.get(commentKey);
    pluginState.pendingComments.delete(commentKey);
    // 获取欢迎词
    const tpl = (settings.welcomeMessage !== undefined && settings.welcomeMessage !== '') ? settings.welcomeMessage : (pluginState.config.welcomeMessage || '');
    const welcomeText = tpl ? tpl.replace(/\{user\}/g, userId).replace(/\{group\}/g, groupId) : '';
    pluginState.log('info', `新成员进群: 用户 ${userId} 加入群 ${groupId}，发起验证`);
    createVerifySession(groupId, userId, comment, welcomeText);
    return;
  }

  // 防撤回
  if (e.post_type === 'notice' && e.notice_type === 'group_recall') {
    const groupId = String(e.group_id);
    const messageId = String(e.message_id);
    const userId = String(e.user_id);
    await handleAntiRecall(groupId, messageId, userId);
    return;
  }

  // 名片锁定检查
  if (e.post_type === 'notice' && e.notice_type === 'group_card') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    await handleCardLockCheck(groupId, userId);
    return;
  }

  // 退群自动拉黑
  if (e.post_type === 'notice' && e.notice_type === 'group_decrease' && e.sub_type === 'leave') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    const settings = pluginState.getGroupSettings(groupId);
    const globalLeave = pluginState.config.leaveBlacklist;
    const groupLeave = settings.leaveBlacklist;
    if (!globalLeave && !groupLeave) return;

    if (!pluginState.config.blacklist) pluginState.config.blacklist = [];
    if (!pluginState.config.blacklist.includes(userId)) {
      pluginState.config.blacklist.push(userId);
      pluginState.log('info', `退群拉黑: 用户 ${userId} 退出群 ${groupId}，已加入黑名单（${globalLeave ? '全局' : '群独立'}设置）`);
      saveConfig(ctx);
    }
    return;
  }
};

export { plugin_init, plugin_onmessage, plugin_onevent, plugin_cleanup };
