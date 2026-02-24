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
  /** 发送群消息 (Text) */
  async sendGroupText (groupId: string, content: string): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    try {
      await this.actions.call('send_group_msg', {
        group_id: groupId,
        message: [{ type: 'text', data: { text: content } }]
      } as never, this.adapterName, this.networkConfig);
    } catch (e) {
      this.log('error', `发送群消息失败: ${e}`);
    }
  }

  /** 发送群消息 (Array) */
  async sendGroupMsg (groupId: string, message: any[]): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    try {
      await this.actions.call('send_group_msg', {
        group_id: groupId,
        message
      } as never, this.adapterName, this.networkConfig);
    } catch (e) {
      this.log('error', `发送群消息失败: ${e}`);
    }
  }

  /** 发送私聊消息 (Text) */
  async sendPrivateMsg (userId: string, content: string): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    try {
      await this.actions.call('send_private_msg', {
        user_id: userId,
        message: [{ type: 'text', data: { text: content } }]
      } as never, this.adapterName, this.networkConfig);
    } catch (e) {
      this.log('error', `发送私聊消息失败: ${e}`);
    }
  }

  /** 调用 API */
  async callApi (action: string, params: any): Promise<any> {
    if (!this.actions || !this.networkConfig) return;
    try {
      return await this.actions.call(action, params as never, this.adapterName, this.networkConfig);
    } catch (e) {
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
