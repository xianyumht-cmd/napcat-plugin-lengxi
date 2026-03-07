import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeAuthCommand } from '../../services/auth_service';

export const AUTH_PREFIXES = [
  '授权 ',
  '回收授权 ',
  '查询授权 ',
  '激活 '
];

export const AUTH_EXACT = [
  '查询授权',
  '授权状态',
  '授权查询'
];

export function matchAuthCommand(text: string): string | null {
  if (AUTH_EXACT.includes(text)) return text;
  for (const p of AUTH_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleAuthCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeAuthCommand({ event, ctx, raw, text, userId, groupId });
}
