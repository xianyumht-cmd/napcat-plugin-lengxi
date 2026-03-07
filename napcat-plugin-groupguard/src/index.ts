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
import { storageAdapter } from './storage_adapter';
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
  }

  // 加载主配置
  if (fs.existsSync(ctx.configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
      pluginState.config = { ...JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG)), ...raw };
      
      // 确保 data 目录存在
      const dataDir = path.join(pluginState.configDir, 'data');
      const groupsDataDir = path.join(dataDir, 'groups');
      if (!fs.existsSync(groupsDataDir)) fs.mkdirSync(groupsDataDir, { recursive: true });

      // 迁移旧的分群配置 (groups/*.json -> data/groups/*/config.json)
      const oldGroupsDir = path.join(pluginState.configDir, 'groups');
      if (fs.existsSync(oldGroupsDir)) {
        const files = fs.readdirSync(oldGroupsDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            const gid = file.replace('.json', '');
            const oldPath = path.join(oldGroupsDir, file);
            const newGroupDir = path.join(groupsDataDir, gid);
            if (!fs.existsSync(newGroupDir)) fs.mkdirSync(newGroupDir, { recursive: true });
            
            // 移动并重命名为 config.json
            const newPath = path.join(newGroupDir, 'config.json');
            if (!fs.existsSync(newPath)) {
                fs.renameSync(oldPath, newPath);
                pluginState.log('info', `已迁移群配置: ${gid}`);
            } else {
                // 如果新位置已有配置，保留新位置，删除旧文件
                fs.unlinkSync(oldPath);
            }
          }
        }
        // 尝试删除空的旧目录
        try { fs.rmdirSync(oldGroupsDir); } catch {}
      }

      storageAdapter.init(pluginState.configDir);
      storageAdapter.migrateFromJson(pluginState.configDir, pluginState.config.groups || {});
      pluginState.config.groups = storageAdapter.loadAllGroupConfigs();

      saveConfig(ctx);

    } catch (e) {
        pluginState.log('error', `加载配置出错: ${e}`);
    }
  }

  // 初始化数据库
  await initDB();

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
  router.getNoAuth('/activity', async (req: any, res: any) => {
    const groupId = req.query?.group_id || '';
    if (groupId) {
      const stats = await dbQuery.getAllActivity(groupId);
      res.json({ code: 0, data: stats || {} });
    } else {
      res.json({ code: 0, data: {} });
    }
  });

  // 预设配置 API
  router.getNoAuth('/presets', (_req: any, res: any) => {
    res.json({ code: 0, data: pluginState.config.presets || [] });
  });

  router.postNoAuth('/presets', (req: any, res: any) => {
    try {
      pluginState.config.presets = req.body?.presets || [];
      saveConfig(ctx);
      res.json({ code: 0, message: '预设已保存' });
    } catch (e) { res.status(500).json({ code: -1, message: String(e) }); }
  });

  pluginState.log('info', 'WebUI 路由已注册');
}

// ========== 配置管理 ==========
export const plugin_get_config = async (): Promise<PluginConfig> => pluginState.config;
export const plugin_set_config = async (ctx: NapCatPluginContext, config: PluginConfig): Promise<void> => {
  pluginState.config = config;
  saveConfig(ctx);
};

// ========== 插件清理 ==========
const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  pluginState.log('info', '群管插件正在卸载...');
  clearAllSessions();
};

// ========== 消息处理 ==========
const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  // 仅处理 message 类型事件
  if (event.post_type !== 'message') return;

  const userId = String(event.user_id);
  const raw = event.raw_message || '';
  const messageId = String(event.message_id);
  const selfId = String((event as any).self_id || '');
  const messageSegments = (event as any).message || [];

  // 1. 私聊消息处理 (优先级最高，不受群授权限制)
  if (event.message_type === 'private') {
      await handleCommand(event, ctx);
      return;
  }

  // 2. 群消息处理
  if (event.message_type === 'group') {
      const groupId = String(event.group_id);

      // 0. 授权检查：未授权群完全静默，不处理任何群内指令或被动功能
      const license = authManager.getGroupLicense(groupId);
      if (!license) {
        return;
      }


  // 0.1 自身消息处理：如果是机器人自己发的消息，跳过大部分检查，仅处理撤回
  if (userId === selfId) {
    // 自身消息撤回逻辑 - 优先使用群独立配置，无配置则回落到全局
    const settings = pluginState.getGroupSettings(groupId);
    if (settings.autoRecallSelf) {
      const delay = (settings.autoRecallSelfDelay || 60) * 1000;
      setTimeout(() => {
        pluginState.callApi('delete_msg', { message_id: messageId }).catch(() => {});
      }, delay);
    }
    return;
  }

    // 2. 群管指令处理 (优先于黑名单，确保主人在黑名单中也能解除)
    const handled = await handleCommand(event, ctx);
    if (handled) return;

    // 0.2 白名单用户检查
    const isWhite = pluginState.isWhitelisted(userId);

    // 1. 黑名单检查（白名单豁免）
    if (!isWhite) {
      const blacklisted = await handleBlacklist(groupId, userId, messageId);
      if (blacklisted) return;
    }

    // 2.5 问答自动回复
    const qaHandled = await handleQA(groupId, userId, raw);
    if (qaHandled) {
      await recordActivity(groupId, userId);
      cacheMessage(messageId, userId, groupId, raw, messageSegments);
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
    await recordActivity(groupId, userId);

    // 7. 缓存消息（防撤回）
    cacheMessage(messageId, userId, groupId, raw, messageSegments);

    // 8. 回应表情
    await handleEmojiReact(groupId, userId, messageId, selfId);

    // 9. 验证答题
    const settings = pluginState.getGroupSettings(groupId);
    if (settings.enableVerify) {
      await handleVerifyAnswer(groupId, userId, raw, messageId);
    }

    // 10. 卡片消息锁 (仅处理 JSON/XML)
    await handleCardLockCheck(groupId, userId, messageId, raw);
    await handleCardLockOnMessage(groupId, userId, messageId, raw);
  }
};

import { GroupJoinVerifier } from './join_verifier';

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

  // 入群申请处理 (重构：使用 GroupJoinVerifier)
  if (e.post_type === 'request' && e.request_type === 'group' && e.sub_type === 'add') {
    const handled = await GroupJoinVerifier.handleJoinRequest(ctx, {
      group_id: groupId,
      user_id: String(e.user_id),
      comment: e.comment,
      flag: e.flag || '',
      sub_type: e.sub_type
    });
    
    if (handled) return;
    
    // 如果 Verifier 返回 false，说明没有触发任何自动规则（如暗号关闭且回落关闭），
    // 此时保留申请，等待管理员手动处理。
    return;
  }

  // 新成员进群 - 发起验证 + 欢迎词
  if (e.post_type === 'notice' && e.notice_type === 'group_increase') {
    const groupId = String(e.group_id);
    const userId = String(e.user_id);
    const operatorId = String(e.operator_id || '');

    // 邀请统计
    if (operatorId && operatorId !== userId && operatorId !== pluginState.botId) {
      const settings = pluginState.getGroupSettings(groupId);
      let firstInvite = false;
      storageAdapter.runInTransaction(() => {
        const inviteeRecord = storageAdapter.getInvite(groupId, userId) || { inviteCount: 0, inviterId: '', invitedUsers: [] };
        if (!inviteeRecord.inviterId) {
          firstInvite = true;
          inviteeRecord.inviterId = operatorId;
          storageAdapter.setInvite(groupId, userId, inviteeRecord);
          let inviterRecord = storageAdapter.getInvite(groupId, operatorId) || { inviteCount: 0, inviterId: '', invitedUsers: [] };
          inviterRecord.inviteCount = Number(inviterRecord.inviteCount || 0) + 1;
          storageAdapter.setInvite(groupId, operatorId, inviterRecord);
          if (settings.invitePoints && settings.invitePoints > 0) {
            let inviterSignin = storageAdapter.getSignin(groupId, operatorId) || { lastSignin: 0, days: 0, points: 0 };
            inviterSignin.points = Number(inviterSignin.points || 0) + settings.invitePoints;
            storageAdapter.setSignin(groupId, operatorId, inviterSignin);
          }
        }
      });
      if (firstInvite && settings.invitePoints && settings.invitePoints > 0) {
        pluginState.log('info', `邀请奖励: 用户 ${operatorId} 邀请 ${userId} 进群，获得 ${settings.invitePoints} 积分`);
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
