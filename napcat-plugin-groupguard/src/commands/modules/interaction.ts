import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeInteractionCommand } from '../../services/interaction_service';

export const INTERACTION_PREFIXES = [
  '兑换 ',
  '开启发言奖励 ',
  '查封号',
  '查隐藏',
  '活跃统计',
  '设置lolurl',
  '设置lolkey',
  '设置loltoken'
];

export const INTERACTION_EXACT = [
  '签到',
  '签到榜',
  '我的积分',
  '抽奖',
  '邀请查询',
  '邀请榜',
  '积分商城',
  '商城',
  '关闭发言奖励'
];

export function matchInteractionCommand(text: string): string | null {
  if (INTERACTION_EXACT.includes(text)) return text;
  for (const p of INTERACTION_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleInteractionCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeInteractionCommand({ event, ctx, raw, text, userId, groupId });
}
