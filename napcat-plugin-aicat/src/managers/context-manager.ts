import type { AIMessage, ContextInfo } from '../types';
import { CONTEXT_MAX_TURNS, CONTEXT_EXPIRE_SECONDS } from '../config';

interface ContextMessage extends AIMessage { isToolSummary?: boolean; }
interface ContextEntry { messages: ContextMessage[]; timestamp: number; }

const CLEANUP_INTERVAL = 120000; // 每2分钟清理过期上下文

export class ContextManager {
  private contexts = new Map<string, ContextEntry>();
  private maxTurns = CONTEXT_MAX_TURNS;
  private expireMs = CONTEXT_EXPIRE_SECONDS * 1000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private getKey (userId: string, groupId?: string): string {
    return groupId ? `g${groupId}_u${userId}` : `p${userId}`;
  }

  private isExpired (key: string): boolean {
    const entry = this.contexts.get(key);
    return !entry || Date.now() - entry.timestamp > this.expireMs;
  }

  getContext (userId: string, groupId?: string): AIMessage[] {
    const key = this.getKey(userId, groupId);
    if (this.isExpired(key)) { this.contexts.delete(key); return []; }
    return (this.contexts.get(key)?.messages || [])
      .map(({ isToolSummary: _, ...msg }) => msg)
      .filter(msg => msg.content);
  }

  addMessage (userId: string, groupId: string | undefined, role: 'user' | 'assistant', content: string, isToolSummary = false): void {
    if (!content) return; // 不存空消息
    const key = this.getKey(userId, groupId);
    if (this.isExpired(key)) this.contexts.set(key, { messages: [], timestamp: Date.now() });
    const entry = this.contexts.get(key)!;
    entry.messages.push({ role, content, isToolSummary });
    // 轮数限制只计算非工具摘要的 user/assistant 对
    this.trimMessages(entry);
    entry.timestamp = Date.now();
  }

  private trimMessages (entry: ContextEntry): void {
    const limit = this.maxTurns * 2;
    // 计算非工具摘要的消息数
    const normalCount = entry.messages.filter(m => !m.isToolSummary).length;
    if (normalCount <= limit) return;
    // 从头部移除最旧的消息，直到普通消息数 <= limit
    let toRemove = normalCount - limit;
    entry.messages = entry.messages.filter(m => {
      if (toRemove <= 0) return true;
      if (!m.isToolSummary) { toRemove--; return false; }
      // 工具摘要跟随其关联的普通消息一起移除（如果前面的普通消息被移除了）
      return false;
    });
  }

  clearContext (userId: string, groupId?: string): void {
    this.contexts.delete(this.getKey(userId, groupId));
  }

  getContextInfo (userId: string, groupId?: string): ContextInfo {
    const key = this.getKey(userId, groupId);
    const entry = this.contexts.get(key);
    const messages = entry?.messages || [];
    const normalMessages = messages.filter(m => !m.isToolSummary);
    return { turns: Math.floor(normalMessages.length / 2), messages: messages.length, expired: this.isExpired(key) };
  }

  // 清理所有过期上下文，防止内存无限增长
  cleanup (): void {
    const now = Date.now();
    for (const [key, entry] of this.contexts) {
      if (now - entry.timestamp > this.expireMs) this.contexts.delete(key);
    }
  }

  startCleanup (): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);
  }

  stopCleanup (): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
    this.contexts.clear();
  }
}

export const contextManager = new ContextManager();
