// AI 客户端 - 调用 OpenAI 兼容 API
import type { AIConfig, AIMessage, AIResponse, Tool } from '../types';
import { MODEL_LIST, YTEA_MODEL_LIST } from '../config';

// 请求附加信息（机器人、主人、用户）
export interface RequestMeta {
  bot_id?: string;
  owner_ids?: string[];
  user_id?: string;
}

export class AIClient {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private timeout: number;
  private apiType: number;
  private autoSwitch: boolean;
  private meta: RequestMeta = {};
  private isMainProxy: boolean;
  private failedModels = new Set<string>();  // 本次会话中失败的模型

  constructor (config: AIConfig, autoSwitch = false) {
    this.baseUrl = config.base_url;
    this.apiKey = config.api_key;
    this.model = config.model;
    this.timeout = config.timeout;
    this.autoSwitch = autoSwitch;
    this.apiType = autoSwitch ? 100 : 1;
    this.isMainProxy = config.base_url.includes('elaina.vin');
  }

  setMeta (meta: RequestMeta): void { this.meta = meta; }
  setAutoSwitch (enabled: boolean): void { this.autoSwitch = enabled; this.apiType = enabled ? 100 : 1; }
  setModel (model: string): void { this.model = model; }
  getModel (): string { return this.model; }
  getApiType (): number { return this.apiType; }
  isAutoSwitch (): boolean { return this.autoSwitch; }

  // 获取可用的模型列表（排除已失败的）
  private getAvailableModels (): string[] {
    const list = this.baseUrl.includes('ytea.top') ? YTEA_MODEL_LIST : MODEL_LIST;
    return list.filter(m => m !== this.model && !this.failedModels.has(m));
  }

  // 带工具调用的对话（含自动切换重试）
  async chatWithTools (messages: AIMessage[], tools: Tool[]): Promise<AIResponse> {
    const result = await this.doRequest(messages, tools);

    // 如果是模型密钥不可用（503）或模型错误（400/404），且开启了自动切换，尝试换模型
    if (this.autoSwitch && result.error && this.isModelError(result)) {
      this.failedModels.add(this.model);
      const alternatives = this.getAvailableModels();

      for (const alt of alternatives) {
        this.model = alt;
        const retry = await this.doRequest(messages, tools);
        if (!retry.error || !this.isModelError(retry)) return retry;
        this.failedModels.add(alt);
      }
      // 所有模型都失败了
      return { choices: [], error: '所有可用模型均请求失败', detail: result.detail };
    }

    return result;
  }

  // 判断是否为模型相关错误（需要切换模型）
  private isModelError (res: AIResponse): boolean {
    const detail = res.detail || '';
    const error = res.error || '';
    // 503: 模型密钥不可用
    if (error.includes('503')) return true;
    // "No active API keys" 明确是模型密钥问题
    if (detail.includes('No active API keys')) return true;
    // 模型不存在
    if (detail.includes('model_not_found') || detail.includes('does not exist')) return true;
    return false;
  }

  // 执行单次请求
  private async doRequest (messages: AIMessage[], tools: Tool[]): Promise<AIResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const payload: Record<string, unknown> = {
        model: this.model,
        messages: messages.map(m => m.content ? m : { ...m, content: '(empty)' }),
      };

      if (this.isMainProxy) {
        payload.type = this.apiType;
        payload.secret_key = '2218872014';
        if (this.meta.bot_id) payload.bot_id = this.meta.bot_id;
        if (this.meta.owner_ids?.length) payload.owner_ids = this.meta.owner_ids;
        if (this.meta.user_id) payload.user_id = this.meta.user_id;
      }

      if (tools.length) {
        payload.tools = tools;
        payload.tool_choice = 'auto';
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const res = await fetch(this.baseUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        return {
          choices: [],
          error: `HTTP错误: ${res.status}`,
          detail: (await res.text()).slice(0, 500),
        };
      }

      return await res.json() as AIResponse;
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === 'AbortError') {
        return { choices: [], error: '请求超时' };
      }
      return { choices: [], error: String(e) };
    }
  }

  // 简单对话
  async chatSimple (messages: AIMessage[]): Promise<string> {
    const res = await this.chatWithTools(messages, []);
    return res.choices?.[0]?.message?.content || '';
  }
}
