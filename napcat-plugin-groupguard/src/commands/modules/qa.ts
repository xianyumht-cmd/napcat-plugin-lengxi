import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeQaCommand } from '../../services/qa_service';

export const QA_PREFIXES = [
  '添加问答 ',
  '添加模糊问答 ',
  '添加正则问答 ',
  '删除问答 ',
  '删问',
  '模糊问',
  '精确问',
  '添加拒绝词',
  '添加全局拒绝词',
  '删除拒绝词',
  '删除全局拒绝词',
  '添加违禁词',
  '添加全局违禁词',
  '删除违禁词',
  '删除全局违禁词',
  '设置违禁词惩罚 ',
  '设置违禁词禁言 '
];

export const QA_EXACT = [
  '问答列表',
  '拒绝词列表',
  '违禁词列表'
];

export function matchQaCommand(text: string): string | null {
  if (QA_EXACT.includes(text)) return text;
  for (const p of QA_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleQaCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeQaCommand({ event, ctx, raw, text, userId, groupId });
}
