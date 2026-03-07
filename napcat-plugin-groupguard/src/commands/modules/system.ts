import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeSystemCommand } from '../../services/system_service';

export const SYSTEM_PREFIXES = [
  '多群广播 ',
  '定时任务 ',
  '删除定时任务 ',
  '设置欢迎词 '
];

export const SYSTEM_EXACT = [
  '菜单',
  '帮助',
  '群管帮助',
  '群管菜单',
  '运行状态',
  '查看SQLite状态',
  '查看存储状态',
  '清空群配置',
  '确认清空群配置',
  '定时列表'
];

export function matchSystemCommand(text: string): string | null {
  if (SYSTEM_EXACT.includes(text)) return text;
  for (const p of SYSTEM_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleSystemCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeSystemCommand({ event, ctx, raw, text, userId, groupId });
}
