// NapCat 自动抢红包插件
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import fs from 'fs';
import path from 'path';

// ==================== 类型定义 ====================
interface PluginConfig {
  enabled: boolean;
  notifyOnly: boolean;
  antiDetect: boolean;
  antiDetectPauseMin: number;
  useRandomDelay: boolean;
  delayMin: number;
  delayMax: number;
  thanksMsgs: string[];
  notifyTarget: string;
  notifyTargetType: 'private' | 'group';
  blockType: 'none' | 'whitelist' | 'blacklist';
  whitelistGroups: string[];
  whitelistUsers: string[];
  whitelistKeywords: string[];
  blacklistGroups: string[];
  blacklistUsers: string[];
  blacklistKeywords: string[];
  stopByTime: boolean;
  stopStartTime: string;
  stopEndTime: string;
  totalGrabbed: number;
  totalAmount: number;
  masterQQ: string;
}

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
  notifyOnly: false,
  antiDetect: false,
  antiDetectPauseMin: 5,
  useRandomDelay: false,
  delayMin: 500,
  delayMax: 3000,
  thanksMsgs: [],
  notifyTarget: '',
  notifyTargetType: 'private',
  blockType: 'none',
  whitelistGroups: [],
  whitelistUsers: [],
  whitelistKeywords: [],
  blacklistGroups: [],
  blacklistUsers: [],
  blacklistKeywords: [],
  stopByTime: false,
  stopStartTime: '00:00',
  stopEndTime: '06:00',
  totalGrabbed: 0,
  totalAmount: 0,
  masterQQ: '',
};

// ==================== 运行时状态 ====================
let config: PluginConfig = { ...DEFAULT_CONFIG };
let configPath = '';
let logger: any = console;
let selfUin = '';

const grabbedBillNos = new Set<string>();
const pausedGroups = new Map<string, number>();
let configWatcher: fs.FSWatcher | null = null;

// ==================== 工具函数 ====================
function log (...args: unknown[]) { logger.info?.('[抢红包]', ...args) ?? console.log('[抢红包]', ...args); }
function logErr (...args: unknown[]) { logger.error?.('[抢红包]', ...args) ?? console.error('[抢红包]', ...args); }

function loadConfig () {
  try {
    if (fs.existsSync(configPath)) {
      Object.assign(config, JSON.parse(fs.readFileSync(configPath, 'utf-8')));
    }
  } catch (e) { logErr('加载配置失败', e); }
}

function saveConfig () {
  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) { logErr('保存配置失败', e); }
}

function sleep (ms: number) { return new Promise(r => setTimeout(r, ms)); }

function randomInt (min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isInTimeRange (start: string, end: string): boolean {
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s < e ? (cur >= s && cur < e) : (cur >= s || cur < e);
}

function isMaster (userId: string | number): boolean {
  const uid = String(userId);
  return config.masterQQ ? uid === config.masterQQ : uid === selfUin;
}

// ==================== 发送消息辅助 ====================
async function sendMsg (ctx: NapCatPluginContext, target: { type: 'group' | 'private'; id: string; }, text: string) {
  try {
    const action = target.type === 'group' ? 'send_group_msg' : 'send_private_msg';
    const idKey = target.type === 'group' ? 'group_id' : 'user_id';
    await ctx.actions.call(action, { [idKey]: target.id, message: [{ type: 'text', data: { text } }] } as never, ctx.adapterName, ctx.pluginManager.config);
  } catch (e) { logErr('发送消息失败', e); }
}

async function sendGroupText (ctx: NapCatPluginContext, groupId: string, text: string) {
  await sendMsg(ctx, { type: 'group', id: groupId }, text);
}

async function sendNotify (ctx: NapCatPluginContext, text: string) {
  if (config.masterQQ) {
    await sendMsg(ctx, { type: 'private', id: config.masterQQ }, text);
  } else if (config.notifyTarget) {
    await sendMsg(ctx, { type: config.notifyTargetType, id: config.notifyTarget }, text);
  } else if (selfUin) {
    await sendMsg(ctx, { type: 'private', id: selfUin }, text);
  }
}

// ==================== 红包提取 ====================
interface WalletInfo {
  walletElement: any;
  peerUid: string;
  peerUin: string;
  senderUin: string;
  senderName: string;
  peerName: string;
  chatType: number;
  msgSeq: string;
}

function extractWalletFromEvent (event: OB11Message): WalletInfo | null {
  const evAny = event as any;

  if (evAny.raw?.elements) {
    for (const el of evAny.raw.elements) {
      if (el.elementType === 9 && el.walletElement) {
        return {
          walletElement: el.walletElement,
          peerUid: evAny.raw.peerUid,
          peerUin: evAny.raw.peerUin || String(event.group_id || event.user_id || ''),
          senderUin: String(event.user_id || evAny.raw.senderUin || ''),
          senderName: evAny.raw.sendMemberName || evAny.raw.sendNickName || event.sender?.nickname || '',
          peerName: evAny.raw.peerName || String(event.group_id || ''),
          chatType: evAny.raw.chatType ?? (event.message_type === 'group' ? 2 : 1),
          msgSeq: evAny.raw.msgSeq || '',
        };
      }
    }
  }

  for (const key of Object.keys(evAny)) {
    const val = evAny[key];
    if (val && typeof val === 'object' && val.elements && Array.isArray(val.elements)) {
      for (const el of val.elements) {
        if (el.elementType === 9 && el.walletElement) {
          return {
            walletElement: el.walletElement,
            peerUid: val.peerUid || '',
            peerUin: val.peerUin || String(event.group_id || event.user_id || ''),
            senderUin: String(event.user_id || val.senderUin || ''),
            senderName: val.sendMemberName || val.sendNickName || event.sender?.nickname || '',
            peerName: val.peerName || String(event.group_id || ''),
            chatType: val.chatType ?? (event.message_type === 'group' ? 2 : 1),
            msgSeq: val.msgSeq || '',
          };
        }
      }
    }
  }

  return null;
}

// ==================== 黑白名单判断 ====================
function shouldGrab (event: OB11Message, walletInfo: WalletInfo): boolean {
  const groupId = String(event.group_id || walletInfo.peerUin || '');
  const userId = String(event.user_id || walletInfo.senderUin || '');

  if (config.blockType === 'whitelist') {
    const inGroup = config.whitelistGroups.length === 0 || config.whitelistGroups.includes(groupId);
    const inUser = config.whitelistUsers.length === 0 || config.whitelistUsers.includes(userId);
    return inGroup && inUser;
  }
  if (config.blockType === 'blacklist') {
    if (config.blacklistGroups.includes(groupId)) return false;
    if (config.blacklistUsers.includes(userId)) return false;
  }
  return true;
}

// ==================== 抢红包核心 ====================
async function handleRedBag (ctx: NapCatPluginContext, walletInfo: WalletInfo) {
  const { walletElement, peerUid, chatType, msgSeq, senderUin, senderName, peerName, peerUin } = walletInfo;
  const startTime = Date.now();
  const billNo = walletElement?.billNo || walletElement?.grabedMsg?.billNo || walletElement?.redBag?.billNo || '';
  const redType = walletElement?.redBag?.redBagType ?? -1;

  if (!billNo) { log('无法获取 billNo，跳过'); return; }
  if (grabbedBillNos.has(billNo)) return;
  grabbedBillNos.add(billNo);

  // 防检测暂停
  const groupId = String(peerUin || '');
  if (config.antiDetect && groupId) {
    const pauseUntil = pausedGroups.get(groupId);
    if (pauseUntil && Date.now() < pauseUntil) {
      log(`群 ${groupId} 防检测暂停中，跳过`);
      return;
    }
  }

  // 时间段禁用
  if (config.stopByTime && isInTimeRange(config.stopStartTime, config.stopEndTime)) {
    log('当前处于禁用时间段，跳过');
    return;
  }

  // 随机延迟
  if (config.useRandomDelay) {
    const delay = randomInt(config.delayMin, config.delayMax);
    log(`随机延迟 ${delay}ms`);
    await sleep(delay);
  }

  // 口令红包处理
  if (walletElement?.redChannel === 32) {
    const wording = walletElement?.receiver?.title || walletElement?.redBag?.authKey || '';
    if (wording) {
      log(`口令红包，发送口令: ${wording}`);
      await sendGroupText(ctx, groupId, wording);
      await sleep(500);
    }
  }

  // 调用抢红包 API
  try {
    // 获取自身信息
    const selfInfo = ctx.core?.selfInfo;
    const selfUin = String(selfInfo?.uin || '');
    const selfNick = selfInfo?.nick || selfUin;

    // pcBody/stringIndex 直接传原始对象，不做任何转换
    // 已验证：原始类数组对象 {0:xx, 1:xx, ...} 是唯一能成功的格式
    const rawPcBody = walletElement?.pcBody;
    const rawIndex = walletElement?.stringIndex;

    const recvUin = chatType === 1 ? selfUin : peerUin;
    const wishing = walletElement?.receiver?.title || '';

    log('抢红包参数:', JSON.stringify({ recvUin, recvType: chatType, peerUid, name: selfNick, wishing, msgSeq }));

    // 获取 msgService（NapCat 标准方式）
    const msgService = ctx.core?.context?.session?.getMsgService?.();
    if (!msgService || typeof msgService.grabRedBag !== 'function') {
      log('grabRedBag API 不可用');
      return;
    }

    // 关键发现：平铺参数 + 原始 pcBody/stringIndex（类数组对象）是唯一能成功的格式
    // grabRedBagReq 包装格式会导致 Promise 永远不 resolve
    const grabParams = {
      recvUin,
      recvType: chatType,
      peerUid,
      name: selfNick,
      pcBody: rawPcBody,   // 直接传原始类数组对象，不转换
      wishing,
      msgSeq,
      index: rawIndex,     // 直接传原始类数组对象，不转换
    };

    log('抢红包格式: 平铺+原始');

    // 发起调用，3s 超时（超时不算失败，native 可能通过 listener 回调结果）
    const grabPromise = msgService.grabRedBag(grabParams);
    const timeoutPromise = sleep(3000).then(() => 'timeout');
    const result = await Promise.race([grabPromise, timeoutPromise]);

    if (result === 'timeout') {
      log('调用已发出（3s 内未返回，可能通过 listener 回调）');
    } else {
      const ret = result as any;
      log('grabRedBag 返回:', JSON.stringify(ret)?.substring(0, 500));
      const rsp = ret?.grabRedBagRsp || ret;
      if (rsp?.recvdOrder?.amount && rsp.recvdOrder.amount !== '0') {
        const amount = parseInt(rsp.recvdOrder.amount) / 100;
        log(`🎉 抢到 ${amount.toFixed(2)} 元`);
      }
      if (ret?.result && ret.result !== 0) {
        log(`服务端返回: ${ret.result} ${ret.errMsg || ''}`);
      }
    }

    config.totalGrabbed++;
    saveConfig();
    const elapsed = Date.now() - startTime;
    log(`✅ billNo=${billNo} 来自 ${senderName}(${senderUin}) 群 ${peerName}(${groupId}) 耗时:${elapsed}ms`);

    // 通知主人
    const notifyText = [
      `🧧 抢到红包！`,
      `📍 群: ${peerName}(${groupId})`,
      `👤 发送者: ${senderName}(${senderUin})`,
      `📊 累计: ${config.totalGrabbed}次`,
    ].join('\n');
    await sendNotify(ctx, notifyText);

    // 感谢消息
    if (config.thanksMsgs.length > 0 && groupId) {
      const msg = config.thanksMsgs[randomInt(0, config.thanksMsgs.length - 1)];
      await sleep(randomInt(1000, 3000));
      await sendGroupText(ctx, groupId, msg);
    }

    // 防检测：抢完后暂停该群
    if (config.antiDetect && groupId) {
      const pauseMs = config.antiDetectPauseMin * 60 * 1000;
      pausedGroups.set(groupId, Date.now() + pauseMs);
    }
  } catch (e) {
    logErr('抢红包失败', e);
  }
}

// ==================== 指令处理（全部仅主人可用） ====================
async function handleCommand (ctx: NapCatPluginContext, event: OB11Message, raw: string) {
  if (!raw.startsWith('#抢红包') && !raw.startsWith('#红包')) return;

  const userId = String(event.user_id || '');
  if (!isMaster(userId)) return; // 全部指令仅主人可触发

  const cmd = raw.replace(/^#(抢红包|红包)\s*/, '').trim();

  const reply = async (text: string) => {
    if (event.message_type === 'group' && event.group_id) {
      await sendGroupText(ctx, String(event.group_id), text);
    } else {
      await sendMsg(ctx, { type: 'private', id: userId }, text);
    }
  };

  if (!cmd || cmd === '状态' || cmd === '帮助') {
    const status = [
      `🧧 自动抢红包 ${config.enabled ? '✅ 已启用' : '❌ 已禁用'}`,
      `📊 累计抢到: ${config.totalGrabbed}次`,
      `🔔 仅通知模式: ${config.notifyOnly ? '是' : '否'}`,
      `⏱ 随机延迟: ${config.useRandomDelay ? `${config.delayMin}-${config.delayMax}ms` : '关闭'}`,
      `🛡 防检测: ${config.antiDetect ? `开启(暂停${config.antiDetectPauseMin}分钟)` : '关闭'}`,
      `🚫 过滤模式: ${config.blockType}`,
      `⏰ 时间禁用: ${config.stopByTime ? `${config.stopStartTime}-${config.stopEndTime}` : '关闭'}`,
      ``,
      `📝 指令列表:`,
      `#抢红包 开启/关闭`,
      `#抢红包 仅通知 开启/关闭`,
      `#抢红包 延迟 <最小> <最大>`,
      `#抢红包 防检测 开启/关闭 [分钟]`,
      `#抢红包 黑名单/白名单 群/用户 添加/删除 <ID>`,
      `#抢红包 过滤 无/白名单/黑名单`,
      `#抢红包 时间 开启/关闭 [开始] [结束]`,
      `#抢红包 感谢 添加/删除/列表 [消息]`,
      `#抢红包 主人 <QQ>`,
      `#抢红包 重置统计`,
    ];
    await reply(status.join('\n'));
    return;
  }

  if (cmd === '开启') { config.enabled = true; saveConfig(); await reply('✅ 已开启自动抢红包'); return; }
  if (cmd === '关闭') { config.enabled = false; saveConfig(); await reply('❌ 已关闭自动抢红包'); return; }

  if (cmd === '仅通知 开启' || cmd === '仅通知开启') { config.notifyOnly = true; saveConfig(); await reply('✅ 已开启仅通知模式'); return; }
  if (cmd === '仅通知 关闭' || cmd === '仅通知关闭') { config.notifyOnly = false; saveConfig(); await reply('✅ 已关闭仅通知模式'); return; }

  const delayMatch = cmd.match(/^延迟\s+(\d+)\s+(\d+)$/);
  if (delayMatch) {
    config.useRandomDelay = true;
    config.delayMin = parseInt(delayMatch[1]);
    config.delayMax = parseInt(delayMatch[2]);
    saveConfig();
    await reply(`✅ 延迟已设置: ${config.delayMin}-${config.delayMax}ms`);
    return;
  }
  if (cmd === '延迟 关闭' || cmd === '延迟关闭') { config.useRandomDelay = false; saveConfig(); await reply('✅ 已关闭随机延迟'); return; }

  const antiMatch = cmd.match(/^防检测\s+(开启|关闭)\s*(\d+)?$/);
  if (antiMatch) {
    config.antiDetect = antiMatch[1] === '开启';
    if (antiMatch[2]) config.antiDetectPauseMin = parseInt(antiMatch[2]);
    saveConfig();
    await reply(config.antiDetect ? `✅ 防检测已开启，暂停${config.antiDetectPauseMin}分钟` : '✅ 防检测已关闭');
    return;
  }

  const blockMatch = cmd.match(/^(黑名单|白名单)\s+(群|用户)\s+(添加|删除)\s+(\d+)$/);
  if (blockMatch) {
    const [, listType, targetType, action, id] = blockMatch;
    const key = `${listType === '黑名单' ? 'blacklist' : 'whitelist'}${targetType === '群' ? 'Groups' : 'Users'}` as keyof PluginConfig;
    const list = config[key] as string[];
    if (action === '添加') {
      if (!list.includes(id)) list.push(id);
      await reply(`✅ 已添加 ${id} 到${listType}${targetType}`);
    } else {
      const idx = list.indexOf(id);
      if (idx >= 0) list.splice(idx, 1);
      await reply(`✅ 已从${listType}${targetType}删除 ${id}`);
    }
    saveConfig();
    return;
  }

  const filterMatch = cmd.match(/^过滤\s+(无|白名单|黑名单)$/);
  if (filterMatch) {
    config.blockType = filterMatch[1] === '白名单' ? 'whitelist' : filterMatch[1] === '黑名单' ? 'blacklist' : 'none';
    saveConfig();
    await reply(`✅ 过滤模式: ${config.blockType}`);
    return;
  }

  const timeMatch = cmd.match(/^时间\s+(开启|关闭)\s*(\d{1,2}:\d{2})?\s*(\d{1,2}:\d{2})?$/);
  if (timeMatch) {
    config.stopByTime = timeMatch[1] === '开启';
    if (timeMatch[2]) config.stopStartTime = timeMatch[2];
    if (timeMatch[3]) config.stopEndTime = timeMatch[3];
    saveConfig();
    await reply(config.stopByTime ? `✅ 时间禁用: ${config.stopStartTime}-${config.stopEndTime}` : '✅ 已关闭时间禁用');
    return;
  }

  const thanksMatch = cmd.match(/^感谢\s+(添加|删除|列表)\s*(.*)$/);
  if (thanksMatch) {
    const [, action, msg] = thanksMatch;
    if (action === '列表') {
      await reply(config.thanksMsgs.length ? `感谢消息列表:\n${config.thanksMsgs.map((m, i) => `${i + 1}. ${m}`).join('\n')}` : '暂无感谢消息');
      return;
    }
    if (action === '添加' && msg) { config.thanksMsgs.push(msg); saveConfig(); await reply(`✅ 已添加感谢消息`); return; }
    if (action === '删除' && msg) {
      const idx = parseInt(msg) - 1;
      if (idx >= 0 && idx < config.thanksMsgs.length) { config.thanksMsgs.splice(idx, 1); saveConfig(); await reply('✅ 已删除'); return; }
      await reply('❌ 序号无效');
      return;
    }
  }

  const masterMatch = cmd.match(/^主人\s+(\d+)$/);
  if (masterMatch) { config.masterQQ = masterMatch[1]; saveConfig(); await reply(`✅ 主人QQ: ${config.masterQQ}`); return; }

  if (cmd === '重置统计') { config.totalGrabbed = 0; config.totalAmount = 0; saveConfig(); await reply('✅ 统计已重置'); return; }

  await reply('❌ 未知指令，发送 #抢红包 查看帮助');
}

// ==================== 插件生命周期 ====================
let plugin_config_ui: any = null;

const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  logger = ctx.logger;
  configPath = ctx.configPath;
  selfUin = String((ctx as any).selfUin || (ctx as any).bot?.uin || '');

  loadConfig();
  log(`初始化完成 | enabled=${config.enabled} | masterQQ=${config.masterQQ || selfUin}`);

  try {
    const C = ctx.NapCatConfig;
    if (C) {
      plugin_config_ui = C.combine(
        C.html(`<div style="padding:12px;background:linear-gradient(135deg,rgba(239,68,68,0.1),rgba(249,115,22,0.1));border:1px solid rgba(239,68,68,0.3);border-radius:10px;margin-bottom:16px"><h3 style="margin:0 0 4px;font-size:15px">🧧 自动抢红包 v1.0.3</h3><p style="margin:0;font-size:12px;color:#9ca3af">作者: 3122662728 | 交流群: 631348711</p></div>`),
        C.boolean('enabled', '总开关', true, '启用自动抢红包'),
        C.boolean('notifyOnly', '仅通知模式', false, '只通知不抢'),
        C.text('masterQQ', '主人QQ', '', '留空则使用机器人QQ'),
        C.boolean('useRandomDelay', '随机延迟', false, '抢红包前随机等待'),
        C.number('delayMin', '最小延迟(ms)', 500),
        C.number('delayMax', '最大延迟(ms)', 3000),
        C.boolean('antiDetect', '防检测', false, '抢完后暂停该群'),
        C.number('antiDetectPauseMin', '暂停时间(分钟)', 5),
        C.select('blockType', '过滤模式', [
          { label: '无过滤', value: 'none' },
          { label: '白名单', value: 'whitelist' },
          { label: '黑名单', value: 'blacklist' },
        ], 'none'),
        C.text('whitelistGroups', '白名单群(逗号分隔)', ''),
        C.text('blacklistGroups', '黑名单群(逗号分隔)', ''),
        C.boolean('stopByTime', '时间段禁用', false),
        C.text('stopStartTime', '禁用开始时间', '00:00'),
        C.text('stopEndTime', '禁用结束时间', '06:00'),
        C.text('notifyTarget', '通知目标', '', '留空则通知主人QQ'),
        C.select('notifyTargetType', '通知类型', [
          { label: '私聊', value: 'private' },
          { label: '群聊', value: 'group' },
        ], 'private'),
      );
    }
  } catch { /* ignore */ }

  // 配置文件监听
  try {
    if (fs.existsSync(configPath)) {
      configWatcher = fs.watch(configPath, () => {
        try { loadConfig(); log('配置已热重载'); } catch { }
      });
    }
  } catch { }
};

export const plugin_get_config = async (): Promise<PluginConfig> => config;
export const plugin_set_config = async (ctx: NapCatPluginContext, newConfig: any): Promise<void> => {
  if (!configPath && ctx.configPath) configPath = ctx.configPath;
  Object.assign(config, newConfig);
  // 处理逗号分隔的字符串转数组
  for (const key of ['whitelistGroups', 'blacklistGroups', 'whitelistUsers', 'blacklistUsers'] as const) {
    if (typeof (config as any)[key] === 'string') {
      (config as any)[key] = (config as any)[key].split(',').map((s: string) => s.trim()).filter(Boolean);
    }
  }
  saveConfig();
};

const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  if (event.post_type !== 'message') return;

  // 指令处理
  const raw = (event.raw_message || '').trim();
  if (raw.startsWith('#抢红包') || raw.startsWith('#红包')) {
    await handleCommand(ctx, event, raw);
    return;
  }

  // 红包检测
  if (!config.enabled) return;

  const walletInfo = extractWalletFromEvent(event);
  if (!walletInfo) return;

  if (!shouldGrab(event, walletInfo)) {
    log(`过滤: 群${walletInfo.peerUin} 用户${walletInfo.senderUin}`);
    return;
  }

  if (config.notifyOnly) {
    const text = `🧧 检测到红包\n📍 群: ${walletInfo.peerName}(${walletInfo.peerUin})\n👤 发送者: ${walletInfo.senderName}(${walletInfo.senderUin})`;
    await sendNotify(ctx, text);
    return;
  }

  await handleRedBag(ctx, walletInfo);
};

const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  if (configWatcher) { configWatcher.close(); configWatcher = null; }
  grabbedBillNos.clear();
  pausedGroups.clear();
  log('插件已清理');
};

export { plugin_init, plugin_onmessage, plugin_cleanup, plugin_config_ui };
