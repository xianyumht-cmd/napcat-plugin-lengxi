import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeModerationCommand } from '../../services/moderation_service';

export const MODERATION_PREFIXES = [
  '警告 ',
  '清除警告 ',
  '查看警告 ',
  '踢出',
  '禁言',
  '解禁',
  '授予头衔',
  '清除头衔',
  '锁定名片',
  '解锁名片',
  '拉黑',
  '取消拉黑',
  '群拉黑',
  '群取消拉黑',
  '白名单',
  '取消白名单',
  '针对',
  '取消针对',
  '开启自身撤回'
];

export const MODERATION_EXACT = [
  '全体禁言',
  '全体解禁',
  '名片锁定列表',
  '开启防撤回',
  '关闭防撤回',
  '防撤回列表',
  '开启回应表情',
  '关闭回应表情',
  '针对列表',
  '清除针对',
  '关闭自身撤回',
  '黑名单列表',
  '群黑名单列表',
  '白名单列表'
];

export function matchModerationCommand(text: string): string | null {
  if (MODERATION_EXACT.includes(text)) return text;
  for (const p of MODERATION_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleModerationCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeModerationCommand({ event, ctx, raw, text, userId, groupId });
}
