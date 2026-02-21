// 图片处理：转存、resolveImageForMarkdown、合并转发
import type { ImageInfo } from '../core/types';
import { state } from '../core/state';
import { addLog } from '../core/logger';
import { probeImageSize } from './message';

/**
 * 将图片转为 QQ CDN URL：
 * 1. 下载网络图片到本地 base64
 * 2. 发到群里获取 QQ CDN URL，然后立即撤回
 */
export async function resolveImageForMarkdown (info: ImageInfo, groupId: string): Promise<{ url: string; width: number; height: number; } | null> {
  if (!state.ctxRef || !state.originalCall || !state.sourceActionsRef) return null;
  let width = info.width || 0;
  let height = info.height || 0;
  const rehost = !!state.config.qqbot?.forceImageRehost;

  if (info.url && !rehost) {
    if (!width || !height) {
      const size = await probeImageSize(info.url);
      width = size.width || width;
      height = size.height || height;
    }
    return { url: info.url, width, height };
  }

  let fileArg: string;

  if (info.url) {
    if (!width || !height) {
      const size = await probeImageSize(info.url);
      width = size.width || width;
      height = size.height || height;
    }
    try {
      addLog('debug', `转存图片: ${info.url}`);
      const res = await fetch(info.url, { signal: AbortSignal.timeout(15000) });
      const arrBuf = await res.arrayBuffer();
      fileArg = `base64://${Buffer.from(arrBuf).toString('base64')}`;
    } catch (e: any) {
      addLog('info', `下载图片失败: ${e.message}, 回退原 URL`);
      return { url: info.url, width, height };
    }
  } else if (info.file) {
    fileArg = info.file;
    if ((!width || !height) && info.file.startsWith('base64://')) {
      try {
        const raw = Buffer.from(info.file.slice(9), 'base64');
        const buf = new Uint8Array(raw);
        if (buf[0] === 0x89 && buf[1] === 0x50) {
          width = (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19];
          height = (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23];
        } else if (buf[0] === 0xFF && buf[1] === 0xD8) {
          let i = 2;
          while (i < buf.length - 9) {
            if (buf[i] !== 0xFF) { i++; continue; }
            const m = buf[i + 1];
            if ((m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
              height = (buf[i + 5] << 8) | buf[i + 6];
              width = (buf[i + 7] << 8) | buf[i + 8];
              break;
            }
            i += 2 + ((buf[i + 2] << 8) | buf[i + 3]);
          }
        }
      } catch { /* ignore */ }
    }
  } else {
    return null;
  }

  if (!state.wildBotQQ) {
    addLog('info', '未获取到野机器人QQ号，无法转存');
    return info.url ? { url: info.url, width, height } : null;
  }
  try {
    const sendResult = await state.originalCall.call(state.sourceActionsRef, 'send_private_msg', {
      user_id: state.wildBotQQ,
      message: [{ type: 'image', data: { file: fileArg! } }],
    }, state.ctxRef.adapterName, state.ctxRef.pluginManager.config) as any;
    const msgId = sendResult?.data?.message_id || sendResult?.message_id;
    if (!msgId) {
      addLog('info', `转存图片发送失败: ${JSON.stringify(sendResult)}`);
      return info.url ? { url: info.url, width, height } : null;
    }
    const msgInfo = await state.originalCall.call(state.sourceActionsRef, 'get_msg', { message_id: msgId }, state.ctxRef.adapterName, state.ctxRef.pluginManager.config) as any;
    const msgData = msgInfo?.data || msgInfo;
    const segments = msgData?.message || [];
    for (const seg of (Array.isArray(segments) ? segments : [])) {
      if (seg?.type === 'image') {
        const cdnUrl = seg?.data?.url || seg?.data?.file;
        if (cdnUrl && typeof cdnUrl === 'string' && cdnUrl.startsWith('http')) {
          addLog('info', `图片转存成功: ${cdnUrl.substring(0, 80)}... ${width}x${height}`);
          if (!width) width = seg.data?.width || parseInt(seg.data?.image_size?.split('x')?.[0]) || 0;
          if (!height) height = seg.data?.height || parseInt(seg.data?.image_size?.split('x')?.[1]) || 0;
          return { url: cdnUrl, width, height };
        }
      }
    }
    addLog('info', `转存后未找到 CDN URL: ${JSON.stringify(msgData)}`);
  } catch (e: any) {
    addLog('info', `图片转存异常: ${e.message}`);
  }
  return info.url ? { url: info.url, width, height } : null;
}

/** 判断是否是合并转发消息 */
export function isForwardMessage (action: string, params: any): boolean {
  return action === 'send_group_forward_msg' || (Array.isArray(params?.message) && params.message.some((s: any) => s?.type === 'node'));
}

/** 从合并转发消息中提取聊天记录，生成 HTML */
export function forwardNodesToHtml (nodes: any[]): string {
  const items: string[] = [];
  for (const node of nodes) {
    if (node?.type !== 'node' || !node?.data) continue;
    const d = node.data;
    const uid = d.uin || d.user_id || d.qq || '';
    const name = esc(String(uid || d.nickname || d.name || '匿名'));
    let text = '';
    if (typeof d.content === 'string') {
      text = esc(d.content);
    } else if (Array.isArray(d.content)) {
      const parts: string[] = [];
      for (const seg of d.content) {
        if (seg?.type === 'text') parts.push(esc(seg.data?.text || ''));
        else if (seg?.type === 'image') parts.push('[图片]');
        else if (seg?.type === 'face') parts.push('[表情]');
        else if (seg?.type === 'at') parts.push(`@${seg.data?.name || seg.data?.qq || ''}`);
      }
      text = parts.join('');
    }
    if (!text) continue;
    items.push(`<div class="msg"><div class="nick">${name}</div><div class="bubble">${text}</div></div>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;padding:16px;width:420px}
.card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.hd{padding:12px 16px;border-bottom:1px solid #e8e8e8;font-size:14px;font-weight:600;color:#333;display:flex;align-items:center;gap:8px}
.hd svg{flex-shrink:0}
.body{padding:8px 16px}
.msg{padding:8px 0;border-bottom:1px solid #f0f0f0}
.msg:last-child{border-bottom:none}
.nick{font-size:12px;color:#1890ff;font-weight:500;margin-bottom:3px}
.bubble{font-size:13px;color:#333;line-height:1.5;word-break:break-all}
.ft{padding:8px 16px;border-top:1px solid #e8e8e8;text-align:center;font-size:10px;color:#999}
</style></head><body>
<div class="card">
  <div class="hd"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1890ff" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>聊天记录</div>
  <div class="body">${items.join('')}</div>
</div>
</body></html>`;
}

export function esc (s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
