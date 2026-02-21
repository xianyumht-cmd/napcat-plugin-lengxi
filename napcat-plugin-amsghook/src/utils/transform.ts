// 消息变换：后缀、替换文本、调用者识别
import { state, ONEBOT_RULE_NAME } from '../core/state';
import { addLog } from '../core/logger';

export function getCallerPlugin (): string | null {
  const stack = new Error().stack || '';
  const patterns = [
    /plugins[/\\](napcat-plugin-[a-zA-Z0-9_-]+)[/\\]/g,
    /(napcat-plugin-[a-zA-Z0-9_-]+)[/\\](?:dist[/\\])?index\.mjs/g,
    /(napcat-plugin-[a-zA-Z0-9_-]+)[/\\][^)\s]*\.mjs/g,
    /file:\/\/\/[^?]*\/(napcat-plugin-[a-zA-Z0-9_-]+)\//g,
  ];
  for (const p of patterns) {
    p.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.exec(stack)) !== null) {
      if (m[1] !== 'napcat-plugin-amsghook') return m[1];
    }
  }
  if (state.config.debug) {
    const brief = stack.split('\n').slice(0, 15).join('\n');
    addLog('debug', `未匹配插件名:\n${brief}`);
  }
  return null;
}

export function getSuffix (pluginName: string | null): string | null {
  const name = pluginName || ONEBOT_RULE_NAME;
  if (name === 'napcat-plugin-amsghook') return null;
  const rule = state.config.rules.find(r => r.name === name);
  if (rule) return rule.enabled ? (rule.suffix || null) : null;
  return null;
}

export function transformParams (params: any, suffix: string): any {
  if (!suffix || !params?.message) return params;
  const msg = params.message;
  if (typeof msg === 'string') return { ...params, message: msg + suffix };
  if (Array.isArray(msg)) {
    let idx = -1;
    for (let i = msg.length - 1; i >= 0; i--) {
      if (msg[i]?.type === 'text' && msg[i]?.data?.text) { idx = i; break; }
    }
    if (idx === -1) return params;
    return {
      ...params, message: msg.map((seg: any, i: number) =>
        i !== idx ? seg : { ...seg, data: { ...seg.data, text: seg.data.text + suffix } }
      ),
    };
  }
  return params;
}

export function applyReplaceText (params: any, replaceText: string): any {
  if (!params?.message) return params;
  const rules: { find: string; rep: string; }[] = [];
  for (const part of replaceText.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) rules.push({ find: part.slice(0, eq), rep: part.slice(eq + 1) });
  }
  if (!rules.length) return params;
  const doReplace = (s: string) => { for (const r of rules) s = s.split(r.find).join(r.rep); return s; };
  const msg = params.message;
  if (typeof msg === 'string') return { ...params, message: doReplace(msg) };
  if (Array.isArray(msg)) {
    return {
      ...params, message: msg.map((seg: any) => {
        if (seg?.type === 'text' && seg?.data?.text) {
          return { ...seg, data: { ...seg.data, text: doReplace(seg.data.text) } };
        }
        return seg;
      }),
    };
  }
  return params;
}
