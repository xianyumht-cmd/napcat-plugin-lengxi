// 入群验证逻辑核心模块 (商用重构)
import { pluginState } from './state';
import { dbQuery } from './db';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { JoinLogEntry } from './types';
import fs from 'fs';
import path from 'path';

/** 入群申请缓存 (防刷) key: groupId:userId value: timestamp[] */
const joinRequestCache = new Map<string, number[]>();

/** 清理缓存间隔 (5分钟) */
const CACHE_TTL = 300000;

setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of joinRequestCache) {
    const valid = timestamps.filter(t => now - t < CACHE_TTL);
    if (valid.length === 0) joinRequestCache.delete(key);
    else joinRequestCache.set(key, valid);
  }
}, 60000);

export class GroupJoinVerifier {
  
  /** 
   * 处理入群申请 
   * 返回 true 表示已处理（无论同意还是拒绝），false 表示交给后续逻辑
   */
  static async handleJoinRequest(
    ctx: NapCatPluginContext,
    event: { 
      group_id: string; 
      user_id: string; 
      comment?: string; 
      flag: string;
      sub_type?: string; 
    }
  ): Promise<boolean> {
    const { group_id: groupId, user_id: userId, comment, flag } = event;
    const settings = pluginState.getGroupSettings(groupId);
    
    // 提取验证信息
    // NapCat/OneBot11 的 comment 通常格式为 "问题：xxx 答案：yyy" 或直接就是答案
    // 这里做简单处理：去掉前缀，提取核心内容
    let answer = comment || '';
    answer = answer.replace(/^问题：.*答案：/, '').trim();
    // 移除不可见字符和多余空格
    answer = answer.replace(/[\r\n\t]/g, ' ').trim();

    // 1. 黑名单检查 (优先级最高)
    if (pluginState.isBlacklisted(userId) || (settings.groupBlacklist || []).includes(userId)) {
      await this.reject(ctx, flag, '您已被列入黑名单');
      this.log(groupId, userId, answer, false, 'reject', '黑名单用户');
      return true;
    }

    // 2. 防刷检测 (5分钟内超过3次)
    const key = `${groupId}:${userId}`;
    const now = Date.now();
    let timestamps = joinRequestCache.get(key) || [];
    timestamps.push(now);
    timestamps = timestamps.filter(t => now - t < CACHE_TTL);
    joinRequestCache.set(key, timestamps);
    
    if (timestamps.length > 3) {
      await this.reject(ctx, flag, '请求过于频繁，请稍后再试');
      this.log(groupId, userId, answer, false, 'reject', `防刷触发 (${timestamps.length}次/5min)`);
      // 可选：自动封禁/拉黑 (暂时不自动拉黑，避免误伤)
      return true;
    }

    // 3. 暗号验证
    const passphrase = settings.entryPassphrase;
    if (passphrase && passphrase.trim()) {
      // 大小写不敏感，全等匹配
      const expected = passphrase.trim().toLowerCase();
      const actual = answer.toLowerCase();
      
      if (expected === actual) {
        await this.approve(ctx, flag);
        this.log(groupId, userId, answer, true, 'approve', '暗号验证通过');
        return true;
      } else {
        // 暗号错误，拒绝
        await this.reject(ctx, flag, '暗号错误，请重新申请');
        this.log(groupId, userId, answer, false, 'reject', `暗号错误 (期望: ${passphrase}, 实际: ${answer})`);
        return true;
      }
    }

    // 4. 拒绝词检查 (仅当暗号未启用时生效，或作为暗号未匹配时的补充？需求说暗号优先)
    // 如果暗号已启用，上面的逻辑已经处理了（要么过，要么拒）。
    // 所以这里是“暗号关闭”后的回落逻辑。
    
    // 5. 自动同意策略回落
    // 如果暗号关闭，检查 enableAutoApproveAfterPassphraseOff
    const enableFallback = settings.enableAutoApproveAfterPassphraseOff !== false; // 默认为 true
    
    if (!enableFallback) {
      // 如果关闭了回落，且没开暗号，或者暗号没对上(上面已处理)，这里实际上意味着“拒绝一切”？
      // 不，如果暗号没开，enableFallback 为 false，则不进行自动处理，交给管理员手动
      return false; 
    }

    // 回落到旧逻辑：拒绝词 -> 自动同意
    const rejectKw = (settings.rejectKeywords?.length ? settings.rejectKeywords : pluginState.config.rejectKeywords) || [];
    if (rejectKw.length && comment) {
      const matched = rejectKw.find(k => comment.includes(k));
      if (matched) {
        await this.reject(ctx, flag, '验证信息包含拒绝关键词');
        this.log(groupId, userId, answer, false, 'reject', `触发拒绝词: ${matched}`);
        return true;
      }
    }

    if (settings.autoApprove) {
      await this.approve(ctx, flag);
      this.log(groupId, userId, answer, false, 'approve', '自动同意 (回落策略)');
      return true;
    }

    return false; // 交给管理员手动
  }

  static async approve(ctx: NapCatPluginContext, flag: string) {
    if (!pluginState.actions || !pluginState.networkConfig) return;
    try {
      await pluginState.actions.call('set_group_add_request', {
        flag, sub_type: 'add', approve: true
      } as never, pluginState.adapterName, pluginState.networkConfig);
    } catch (e) {
      pluginState.log('error', `自动同意失败: ${e}`);
    }
  }

  static async reject(ctx: NapCatPluginContext, flag: string, reason: string) {
    if (!pluginState.actions || !pluginState.networkConfig) return;
    try {
      await pluginState.actions.call('set_group_add_request', {
        flag, sub_type: 'add', approve: false, reason
      } as never, pluginState.adapterName, pluginState.networkConfig);
    } catch (e) {
      pluginState.log('error', `自动拒绝失败: ${e}`);
    }
  }

  /** 记录日志 (异步写入) */
  static log(groupId: string, userId: string, answer: string, matched: boolean, action: 'approve' | 'reject', reason: string) {
    const entry: JoinLogEntry = {
      groupId, userId, answer, passphraseMatched: matched, action, reason, timestamp: Date.now()
    };
    
    // 异步写入文件
    setImmediate(() => {
      try {
        const logDir = path.join(pluginState.configDir, 'data', 'groups', groupId);
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        const logPath = path.join(logDir, 'join_logs.json');
        
        let logs: JoinLogEntry[] = [];
        if (fs.existsSync(logPath)) {
          try {
            logs = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
          } catch { /* ignore corrupted */ }
        }
        
        logs.push(entry);
        
        // 保留90天 (90 * 24 * 60 * 60 * 1000 = 7776000000)
        const expire = Date.now() - 7776000000;
        logs = logs.filter(l => l.timestamp > expire);
        
        fs.writeFileSync(logPath, JSON.stringify(logs, null, 2), 'utf-8');
      } catch (e) {
        pluginState.log('error', `写入入群日志失败: ${e}`);
      }
    });
  }
}
