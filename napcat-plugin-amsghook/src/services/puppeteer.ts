// Puppeteer 插件集成：探测、渲染、上传
import { state } from '../core/state';
import { addLog } from '../core/logger';
import { resolveImageForMarkdown } from '../utils/image';

export async function probePuppeteer (): Promise<void> {
  const ports = [6099, 3000, 6090, 8080];
  for (const port of ports) {
    try {
      const url = `http://127.0.0.1:${port}/plugin/napcat-plugin-puppeteer/api/info`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const data = await res.json() as any;
      if (data?.code === 0) {
        state.puppeteerBaseUrl = `http://127.0.0.1:${port}/plugin/napcat-plugin-puppeteer/api`;
        addLog('info', `puppeteer 插件已连接: port=${port}`);
        return;
      }
    } catch { /* ignore */ }
  }
  addLog('info', '检测到你并未连接到 puppeteer 插件，合并消息渲染为图片无法使用。');
}

export async function renderHtmlToBase64 (html: string): Promise<string | null> {
  if (!state.puppeteerBaseUrl) {
    addLog('info', '检测到你并未连接到 puppeteer 插件，合并消息渲染为图片无法使用。');
    return null;
  }
  try {
    const url = `${state.puppeteerBaseUrl}/render`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html, file_type: 'htmlString', selector: 'body', type: 'png', encoding: 'base64', setViewport: { width: 420, height: 100 } }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json() as { code: number; data?: string; };
    if (data.code === 0 && data.data) return data.data;
    addLog('info', `puppeteer 渲染失败: ${JSON.stringify(data)}`);
    return null;
  } catch (e: any) {
    addLog('info', `puppeteer 渲染请求失败: ${e.message}`);
    return null;
  }
}

export async function uploadBase64Image (base64: string, groupId: string): Promise<string | null> {
  const result = await resolveImageForMarkdown({ file: `base64://${base64}` }, groupId);
  return result?.url || null;
}
