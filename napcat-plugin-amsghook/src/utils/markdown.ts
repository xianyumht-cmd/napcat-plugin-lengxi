// Markdown 文本拆分 + 通过官方机器人发送
import { state, groupEventIdCache } from '../core/state';
import { addLog } from '../core/logger';

const MD_PATTERNS = [
  /(!?\[.*?\])(\s*\(.*?\))/g,
  /(\[.*?\])(\[.*?\])/g,
  /(\*)([^*]+?\*)/g,
  /(`)([^`]+?`)/g,
  /(_)([^_]*?_)/g,
];
const LINK_PATTERN = /\[([^\]]*)\]\(([^)]*)\)/;
const MD_LINK_BREAKER = '](mqqapi://aio/inlinecmd?command=lengximsghook&enter=false&reply=false)';

export function splitMarkdownText (text: string): string[] {
  text = text.replace(/\n/g, '\r');
  const delimiter = '\x00SPLIT\x00';
  for (const pattern of MD_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, `$1${delimiter}$2`);
  }
  let parts = text.includes(delimiter) ? text.split(delimiter) : [text];
  const finalParts: string[] = [];
  for (const part of parts) {
    finalParts.push(...splitBracketLinks(part));
  }
  return mergeSplitParts(finalParts);
}

export function splitSingleParamValues (text: string): string[] {
  const parts = splitMarkdownText(text);
  if (parts.length <= 1) return parts;
  const prefixed = MD_LINK_BREAKER + text;
  return splitMarkdownText(prefixed);
}

function splitBracketLinks (text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '[') {
      const match = text.slice(i).match(/^\[([^\]]*)\]\(([^)]*)\)/);
      if (match) {
        current += '[' + match[1];
        if (current) parts.push(current);
        current = '](' + match[2] + ')';
        i += match[0].length;
      } else {
        current += text[i];
        i++;
      }
    } else {
      current += text[i];
      i++;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [text];
}

function mergeSplitParts (parts: string[]): string[] {
  if (parts.length <= 1) return parts;
  const merged: string[] = [];
  let current = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const test = current + parts[i];
    if (LINK_PATTERN.test(test)) {
      merged.push(current);
      current = parts[i];
    } else {
      current = test;
    }
  }
  if (current) merged.push(current);
  return merged;
}

export async function sendContentViaOfficialBot (
  groupId: string, groupOpenId: string, eventId: string,
  content: string, imageUrl?: string | null, imgWidth?: number, imgHeight?: number,
): Promise<boolean> {
  if (!state.qqbotBridge) return false;
  const qcfg = state.config.qqbot;
  let tplId: string;
  let params: { key: string; values: string[]; }[];

  if (imageUrl && qcfg?.imgMarkdownTemplateId) {
    const w = imgWidth || 100;
    const h = imgHeight || 100;
    tplId = qcfg.imgMarkdownTemplateId;
    params = [
      { key: 'px', values: [`#${w}px #${h}px`] },
      { key: 'url', values: [imageUrl] },
    ];
    if (content) {
      const splitValues = splitSingleParamValues('\r' + content);
      params.push({ key: 'text', values: splitValues });
    }
  } else if (qcfg?.textMarkdownTemplateId) {
    tplId = qcfg.textMarkdownTemplateId;
    const splitValues = splitSingleParamValues(content || '1');
    params = [{ key: 'text', values: splitValues }];
  } else {
    addLog('info', '未配置 markdown 模板 ID');
    return false;
  }

  try {
    const result = await state.qqbotBridge.sendGroupMarkdownMsg(
      groupOpenId, tplId, params, undefined, { event_id: eventId },
    );
    if (result && !result.code) {
      addLog('info', `官方机器人代发成功: 群=${groupId}(${groupOpenId}), eventId=${eventId}`);
      return true;
    } else {
      addLog('info', `官方机器人代发失败: 群=${groupId}, resp=${JSON.stringify(result)}`);
      if (result?.code) groupEventIdCache.delete(groupId);
      return false;
    }
  } catch (e: any) {
    addLog('info', `官方机器人代发异常: ${e.message}`);
    return false;
  }
}


/**
 * 通过官方机器人发送富媒体消息（语音/视频）
 * file_type: 2=视频, 3=语音
 */
export async function sendMediaViaOfficialBot (
  groupId: string, groupOpenId: string, eventId: string,
  fileBase64: string, fileType: number, content?: string,
): Promise<boolean> {
  if (!state.qqbotBridge) return false;
  try {
    const fileInfo = await state.qqbotBridge.uploadGroupMedia(groupOpenId, fileBase64, fileType);
    if (!fileInfo) {
      addLog('info', `官方机器人上传媒体失败: 群=${groupId}, type=${fileType}`);
      return false;
    }
    const result = await state.qqbotBridge.sendGroupMediaMsg(groupOpenId, fileInfo, content, { event_id: eventId });
    if (result && !result.code) {
      addLog('info', `官方机器人媒体代发成功: 群=${groupId}(${groupOpenId}), type=${fileType}`);
      return true;
    } else {
      addLog('info', `官方机器人媒体代发失败: 群=${groupId}, resp=${JSON.stringify(result)}`);
      if (result?.code) groupEventIdCache.delete(groupId);
      return false;
    }
  } catch (e: any) {
    addLog('info', `官方机器人媒体代发异常: ${e.message}`);
    return false;
  }
}
