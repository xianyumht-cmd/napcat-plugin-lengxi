// 插件全局状态管理
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig, VerifySession, GroupGuardSettings, ActivityRecord, SigninData, InviteData } from './types';
import { DEFAULT_PLUGIN_CONFIG } from './config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

// 运行时从 package.json 读取版本号
function getPluginVersion (): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '1.0.0';
    }
  } catch { /* 读取失败使用默认版本 */ }
  return '1.0.0';
}

interface LogEntry {
  time: number;
  level: string;
  msg: string;
}

interface GroupSendTask {
  groupId: string;
  message: any[];
  force: boolean;
  applyTemplate: boolean;
  resolve: () => void;
  reject: (err?: any) => void;
}

class PluginState {
  /** 插件版本（运行时从 package.json 读取） */
  version: string = getPluginVersion();
  logger: PluginLogger | null = null;
  actions: ActionMap | undefined;
  adapterName = '';
  networkConfig: NetworkAdapterConfig | null = null;
  config: PluginConfig = JSON.parse(JSON.stringify(DEFAULT_PLUGIN_CONFIG));
  sessions: Map<string, VerifySession> = new Map();
  pendingComments: Map<string, string> = new Map();
  botId = '';  // 机器人自身QQ号
  /** 防撤回消息缓存 key: messageId */
  msgCache: Map<string, { userId: string; groupId: string; raw: string; segments: any[]; time: number; }> = new Map();
  /** 刷屏检测缓存 key: `${groupId}:${userId}`, value: 时间戳数组 */
  spamCache: Map<string, number[]> = new Map();
  /** 复读检测缓存 key: `${groupId}:${userId}`, value: { content: string, count: number } */
  repeatCache: Map<string, { content: string; count: number }> = new Map();
  /** 调试日志缓冲区 */
  logBuffer: LogEntry[] = [];
  private readonly maxLogEntries = 500;

  /** 管理员权限缓存 key: `${groupId}:${userId}`, value: { role: string, expire: number } */
  adminCache: Map<string, { role: string; expire: number }> = new Map();
  /** 启动时间 */
  startTime: number = Date.now();
  /** 处理消息数 */
  msgCount: number = 0;
  /** 问答关键词冷却缓存 key: `${groupId}:${keyword}` */
  qaCooldownMap: Map<string, number> = new Map();
  /** 全局发送队列 */
  private globalSendQueue: GroupSendTask[] = [];
  /** 分群发送队列 */
  private groupSendQueues: Map<string, GroupSendTask[]> = new Map();
  /** 队列调度索引（分群轮询） */
  private queueRoundRobinIndex = 0;
  /** 当前发送中的 worker 数 */
  private activeWorkers = 0;
  /** TokenBucket 当前令牌 */
  private tokenBucketTokens = 0;
  /** TokenBucket 上次补充时间 */
  private tokenBucketLastRefill = Date.now();
  /** 分群发送记录（用于熔断） */
  private groupSendHistory: Map<string, number[]> = new Map();
  /** 分群熔断截止时间 */
  private groupFuseUntil: Map<string, number> = new Map();

  // ===== 内存优化 =====
  /** 清理内存缓存 */
  cleanCache() {
    const now = Date.now();
    // 1. 清理防撤回缓存 (保留 5 分钟)
    for (const [key, val] of this.msgCache.entries()) {
      if (now - val.time > 300000) this.msgCache.delete(key);
    }
    // 2. 清理权限缓存 (保留 10 分钟内未过期)
    for (const [key, val] of this.adminCache.entries()) {
      if (now > val.expire + 600000) this.adminCache.delete(key);
    }
    // 3. 清理会话 (保留 10 分钟)
    for (const [key, val] of this.sessions.entries()) {
      if (now - val.startTime > 600000) this.sessions.delete(key);
    }
    // 4. 限制日志缓冲区
    if (this.logBuffer.length > 200) {
      this.logBuffer = this.logBuffer.slice(-200);
    }
    // 5. 清理问答冷却缓存（最多保留 10 分钟）
    for (const [key, ts] of this.qaCooldownMap.entries()) {
      if (now - ts > 600000) this.qaCooldownMap.delete(key);
    }
    for (const [groupId, list] of this.groupSendHistory.entries()) {
      const pruned = list.filter(t => now - t < 300000);
      if (pruned.length) this.groupSendHistory.set(groupId, pruned);
      else this.groupSendHistory.delete(groupId);
    }
    for (const [groupId, until] of this.groupFuseUntil.entries()) {
      if (now >= until) this.groupFuseUntil.delete(groupId);
    }
  }

  private pushLog (level: string, msg: string): void {
    this.logBuffer.push({ time: Date.now(), level, msg });
    if (this.logBuffer.length > this.maxLogEntries) this.logBuffer.splice(0, this.logBuffer.length - this.maxLogEntries);
  }

  log (level: 'info' | 'warn' | 'error', msg: string): void {
    this.logger?.[level](`[GroupGuard] ${msg}`);
    this.pushLog(level, msg);
  }

  clearLogs(): void {
    this.logBuffer = [];
  }

  debug (msg: string): void {
    if (this.config.debug) {
      this.logger?.info(`[GroupGuard][Debug] ${msg}`);
      this.pushLog('info', `[Debug] ${msg}`);
    }
  }

  getGroupSettings (groupId: string): GroupGuardSettings {
    if (this.config.groups[groupId]) {
      if (this.config.groups[groupId].useGlobal) return this.config.global;
      return { ...this.config.global, ...this.config.groups[groupId] };
    }
    return this.config.global;
  }

  isWhitelisted (userId: string): boolean {
    return this.config.whitelist.includes(userId);
  }

  isBlacklisted (userId: string): boolean {
    return this.config.blacklist.includes(userId);
  }

  isOwner (userId: string): boolean {
    // 强制转换为字符串并分割，防止配置格式错误
    const ownersStr = String(this.config.ownerQQs || '');
    const configOwners = ownersStr.split(/[,，]/).map(s => s.trim()).filter(s => s);
    const target = String(userId);
    const isMatch = configOwners.includes(target);
    
    // 调试日志：输出详细比对信息
    if (this.config.debug) {
         this.log('info', `[AuthCheck] User: "${target}", Config: "${ownersStr}", Parsed: ${JSON.stringify(configOwners)}, Result: ${isMatch}`);
    }
    return isMatch;
  }

  // ===== 辅助方法 =====
  /** 生成随机后缀 */
  private getRandomSuffix(groupId?: string): string {
    // 强制使用全局配置，防风控策略统一管理
    const settings = this.config.global;
    if (!settings.randomSuffix) return '';
    
    // 生成一个不可见字符或随机短字符串
    // 为了更好的防风控效果，使用随机的零宽字符组合或常见的末尾标点变体
    const chars = ['\u200b', '\u200c', '\u200d', '\u2060', ' ', '.', '..', '~'];
    const len = Math.floor(Math.random() * 3) + 1;
    let suffix = '';
    for (let i = 0; i < len; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    return suffix;
  }

  /** 随机延迟 */
  private async randomSleep(groupId?: string): Promise<void> {
    // 强制使用全局配置，防风控策略统一管理
    const settings = this.config.global;
    const min = settings.randomDelayMin || 0;
    const max = settings.randomDelayMax || 0;
    
    if (max > min && max > 0) {
      const delay = Math.floor(Math.random() * (max - min + 1)) + min;
      if (delay > 0) {
        if (this.config.debug) this.log('info', `[AntiRisk] 随机延迟: ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  private getGlobalSettings() {
    return this.config.global || ({} as GroupGuardSettings);
  }

  private getQueueConcurrency(): number {
    const n = Number(this.getGlobalSettings().queueConcurrency || 1);
    return Math.max(1, Math.min(20, Number.isFinite(n) ? n : 1));
  }

  private getQueueMode(): 'global' | 'group' {
    return this.getGlobalSettings().queueMode === 'global' ? 'global' : 'group';
  }

  private getMaxQueueSizeGlobal(): number {
    const n = Number(this.getGlobalSettings().maxQueueSizeGlobal ?? 3000);
    return Math.max(100, Number.isFinite(n) ? n : 3000);
  }

  private getMaxQueueSizePerGroup(): number {
    const n = Number(this.getGlobalSettings().maxQueueSizePerGroup ?? 120);
    return Math.max(20, Number.isFinite(n) ? n : 120);
  }

  private applyReplyTemplate(text: string): string {
    const settings = this.getGlobalSettings();
    const templates = Array.isArray(settings.replyTemplatePool)
      ? settings.replyTemplatePool.filter(t => typeof t === 'string' && t.includes('{msg}'))
      : [];
    if (!templates.length) return text;
    const tpl = templates[Math.floor(Math.random() * templates.length)] || '{msg}';
    return tpl.replace(/\{msg\}/g, text);
  }

  private shouldSendByProbability(): boolean {
    const settings = this.getGlobalSettings();
    const p = Number(settings.replyProbability ?? 100);
    const probability = Math.max(0, Math.min(100, Number.isFinite(p) ? p : 100));
    return Math.random() * 100 < probability;
  }

  private refillTokens(): void {
    const settings = this.getGlobalSettings();
    const perMinuteRaw = Number(settings.globalMaxPerMinute ?? 180);
    const perMinute = Math.max(1, Number.isFinite(perMinuteRaw) ? perMinuteRaw : 180);
    const now = Date.now();
    const elapsed = now - this.tokenBucketLastRefill;
    if (elapsed <= 0) return;
    const refill = elapsed * (perMinute / 60000);
    this.tokenBucketTokens = Math.min(perMinute, this.tokenBucketTokens + refill);
    this.tokenBucketLastRefill = now;
  }

  private async acquireToken(): Promise<boolean> {
    const settings = this.getGlobalSettings();
    const perMinuteRaw = Number(settings.globalMaxPerMinute ?? 180);
    const perMinute = Math.max(1, Number.isFinite(perMinuteRaw) ? perMinuteRaw : 180);
    const enqueueOnLimit = settings.rateLimitEnqueue !== false;
    if (this.tokenBucketTokens <= 0) {
      this.tokenBucketTokens = perMinute;
      this.tokenBucketLastRefill = Date.now();
    }
    this.refillTokens();
    if (this.tokenBucketTokens >= 1) {
      this.tokenBucketTokens -= 1;
      return true;
    }
    if (!enqueueOnLimit) return false;
    const need = 1 - this.tokenBucketTokens;
    const waitMs = Math.max(30, Math.ceil(need * (60000 / perMinute)));
    await new Promise(resolve => setTimeout(resolve, waitMs));
    return this.acquireToken();
  }

  private cloneMessage(message: any[]): any[] {
    return Array.isArray(message) ? message.map(seg => ({ ...seg, data: seg?.data ? { ...seg.data } : seg?.data })) : [];
  }

  private isGroupFused(groupId: string): boolean {
    const until = this.groupFuseUntil.get(groupId) || 0;
    if (!until) return false;
    if (Date.now() >= until) {
      this.groupFuseUntil.delete(groupId);
      return false;
    }
    return true;
  }

  private markGroupSend(groupId: string): void {
    const settings = this.getGlobalSettings();
    const windowSec = Math.max(10, Number(settings.groupFuseWindowSeconds ?? 60));
    const threshold = Math.max(10, Number(settings.groupFuseThreshold ?? 45));
    const cooldownSec = Math.max(10, Number(settings.groupFuseCooldownSeconds ?? 90));
    const now = Date.now();
    const history = (this.groupSendHistory.get(groupId) || []).filter(t => now - t < windowSec * 1000);
    history.push(now);
    this.groupSendHistory.set(groupId, history);
    if (history.length >= threshold) {
      this.groupFuseUntil.set(groupId, now + cooldownSec * 1000);
      this.log('warn', `群 ${groupId} 触发发送熔断，持续 ${cooldownSec}s`);
    }
  }

  private enqueueGroupTask(groupId: string, message: any[], options?: { force?: boolean; applyTemplate?: boolean; }): Promise<void> {
    if (!this.actions || !this.networkConfig) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const task: GroupSendTask = { groupId, message, force: options?.force === true, applyTemplate: options?.applyTemplate !== false, resolve, reject };
      if (this.getQueueMode() === 'global') {
        if (this.globalSendQueue.length >= this.getMaxQueueSizeGlobal()) {
          if (!task.force) {
            resolve();
            return;
          }
          this.globalSendQueue.shift();
        }
        this.globalSendQueue.push(task);
      } else {
        const q = this.groupSendQueues.get(groupId) || [];
        if (q.length >= this.getMaxQueueSizePerGroup()) {
          if (!task.force) {
            resolve();
            return;
          }
          q.shift();
        }
        q.push(task);
        this.groupSendQueues.set(groupId, q);
      }
      this.kickQueueWorkers();
    });
  }

  private pickNextTask(): GroupSendTask | null {
    if (this.getQueueMode() === 'global') {
      return this.globalSendQueue.shift() || null;
    }
    const keys = Array.from(this.groupSendQueues.keys());
    if (!keys.length) return null;
    for (let i = 0; i < keys.length; i++) {
      const idx = (this.queueRoundRobinIndex + i) % keys.length;
      const gid = keys[idx];
      const q = this.groupSendQueues.get(gid);
      if (q && q.length) {
        const task = q.shift() || null;
        if (!q.length) this.groupSendQueues.delete(gid);
        this.queueRoundRobinIndex = idx + 1;
        return task;
      }
    }
    return null;
  }

  private kickQueueWorkers(): void {
    const maxWorkers = this.getQueueConcurrency();
    while (this.activeWorkers < maxWorkers) {
      const task = this.pickNextTask();
      if (!task) return;
      this.activeWorkers += 1;
      this.processTask(task)
        .catch(err => this.log('error', `队列发送异常: ${err}`))
        .finally(() => {
          this.activeWorkers = Math.max(0, this.activeWorkers - 1);
          this.kickQueueWorkers();
        });
    }
  }

  private async processTask(task: GroupSendTask): Promise<void> {
    try {
      if (!task.force && this.isGroupFused(task.groupId)) {
        task.resolve();
        return;
      }
      await this.randomSleep(task.groupId);
      const canSend = await this.acquireToken();
      if (!canSend) {
        task.resolve();
        return;
      }
      await this.sendGroupMessageRaw(task.groupId, task.message);
      this.markGroupSend(task.groupId);
      task.resolve();
    } catch (e) {
      this.log('error', `发送群消息失败: ${e}`);
      task.reject(e);
    }
  }

  private async sendGroupMessageRaw(groupId: string, message: any[]): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    const res = await this.actions.call('send_group_msg', {
      group_id: groupId,
      message
    } as never, this.adapterName, this.networkConfig) as { message_id?: number | string };
    if (res && res.message_id) {
      const settings = this.getGroupSettings(groupId);
      if (settings.autoRecallSelf) {
        const delay = (settings.autoRecallSelfDelay || 60) * 1000;
        setTimeout(() => {
          this.callApi('delete_msg', { message_id: res.message_id }).catch(() => {});
        }, delay);
      }
    }
  }

  /** 发送群消息 (Text) */
  async sendGroupText (groupId: string, content: string, options?: { force?: boolean; applyTemplate?: boolean; }): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    const force = options?.force !== false;
    const applyTemplate = options?.applyTemplate !== false;
    if (!force && !this.shouldSendByProbability()) return;
    const templated = applyTemplate ? this.applyReplyTemplate(content) : content;
    const suffix = this.getRandomSuffix(groupId);
    const finalContent = templated + suffix;
    await this.enqueueGroupTask(groupId, [{ type: 'text', data: { text: finalContent } }], { force, applyTemplate });
  }

  /** 发送群消息 (Array) */
  async sendGroupMsg (groupId: string, message: any[], options?: { force?: boolean; applyTemplate?: boolean; }): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    const force = options?.force !== false;
    const applyTemplate = options?.applyTemplate !== false;
    if (!force && !this.shouldSendByProbability()) return;
    const cloned = this.cloneMessage(message);
    const firstText = cloned.find(seg => seg && seg.type === 'text' && seg.data && typeof seg.data.text === 'string');
    if (firstText && applyTemplate) {
      firstText.data.text = this.applyReplyTemplate(firstText.data.text);
    }
    const suffix = this.getRandomSuffix(groupId);
    if (suffix && Array.isArray(cloned)) {
      const lastNode = cloned[cloned.length - 1];
      if (lastNode && lastNode.type === 'text' && lastNode.data) {
        lastNode.data.text += suffix;
      } else {
        cloned.push({ type: 'text', data: { text: suffix } });
      }
    }
    await this.enqueueGroupTask(groupId, cloned, { force, applyTemplate });
  }

  /** 发送私聊消息 (Text) */
  async sendPrivateMsg (userId: string, content: string): Promise<void> {
    if (!this.actions || !this.networkConfig) return;

    // 应用随机延迟
    await this.randomSleep();

    // 应用随机后缀
    const suffix = this.getRandomSuffix();
    const finalContent = content + suffix;

    try {
      await this.actions.call('send_private_msg', {
        user_id: userId,
        message: [{ type: 'text', data: { text: finalContent } }]
      } as never, this.adapterName, this.networkConfig);
    } catch (e) {
      this.log('error', `发送私聊消息失败: ${e}`);
    }
  }

  /** 调用 API */
  async callApi (action: string, params: any): Promise<any> {
    if (!this.actions || !this.networkConfig) return;
    
    // 针对 delete_msg 做特殊处理 (类型转换 + 重试机制)
    if (action === 'delete_msg' && params && params.message_id) {
        // 某些 NT 版本下，message_id 作为 string 传递更稳定
        params.message_id = String(params.message_id);
    }

    try {
      return await this.actions.call(action, params as never, this.adapterName, this.networkConfig);
    } catch (e: any) {
      const errMsg = String(e);
      
      // 针对 delete_msg 的特殊优化
      if (action === 'delete_msg') {
          // 1. 如果是超时或无响应，且消息其实已经发出去了，我们降低日志级别并重试一次
          if (errMsg.includes('Timeout') || errMsg.includes('No data returned') || errMsg.includes('decode failed')) {
              if (this.config.debug) this.log('warn', `撤回消息请求超时，尝试重试一次...`);
              await new Promise(resolve => setTimeout(resolve, 300)); // 缩短重试间隔
              try {
                  return await this.actions.call(action, params as never, this.adapterName, this.networkConfig);
              } catch (retryErr) {
                  // 2. 如果重试也失败，通常是因为消息已经不存在了（撤回成功了），此时保持静默
                  if (this.config.debug) this.log('info', `撤回消息最终确认: 已处理或失效`);
                  return null;
              }
          }
          // 3. 其他类型的错误（如权限不足），仅在 debug 模式下记录
          if (this.config.debug) this.log('warn', `撤回消息 API 调用异常: ${errMsg}`);
          return null;
      }
      
      this.log('error', `API调用失败 [${action}]: ${e}`);
      return null;
    }
  }

  /** 检查机器人是否为管理员 */
  async isBotAdmin (groupId: string): Promise<boolean> {
    if (!this.botId) return false;
    try {
      const info = await this.callApi('get_group_member_info', { group_id: groupId, user_id: this.botId }) as any;
      return info?.role === 'admin' || info?.role === 'owner';
    } catch {
      return false;
    }
  }
}

export const pluginState = new PluginState();
