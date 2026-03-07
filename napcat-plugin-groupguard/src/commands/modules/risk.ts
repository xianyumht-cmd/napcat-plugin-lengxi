import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { executeRiskCommand } from '../../services/risk_service';

export const RISK_PREFIXES = [
  '设置随机延迟 ',
  '设置发送队列模式 ',
  '设置发送并发 ',
  '设置全局限流 ',
  '设置问答冷却 ',
  '设置用户冷却 ',
  '设置分级冷却 ',
  '设置群熔断 ',
  '设置回复概率 ',
  '设置回复模板 ',
  '设置权限缓存 ',
  '开启宵禁 ',
  '设置复读阈值 ',
  '设置刷屏窗口 ',
  '设置刷屏阈值 ',
  '设置刷屏禁言 ',
  '设置入群暗号 ',
  '设置暗号 ',
  '开启功能 ',
  '关闭功能 ',
  '屏蔽 ',
  '取消屏蔽 '
];

export const RISK_EXACT = [
  '查看发送策略',
  '开启调试',
  '关闭调试',
  '开启随机后缀',
  '关闭随机后缀',
  '开启全局自身撤回',
  '关闭全局自身撤回',
  '开启刷屏检测',
  '关闭刷屏检测',
  '关闭宵禁',
  '开启入群验证',
  '关闭入群验证',
  '开启自动审批',
  '关闭自动审批',
  '开启退群拉黑',
  '关闭退群拉黑',
  '关闭入群暗号',
  '开启暗号回落',
  '关闭暗号回落',
  '开启二维码撤回',
  '关闭二维码撤回',
  '风控设置',
  '安全设置'
];

export function matchRiskCommand(text: string): string | null {
  if (RISK_EXACT.includes(text)) return text;
  for (const p of RISK_PREFIXES) {
    if (text.startsWith(p)) return p;
  }
  return null;
}

export async function handleRiskCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const userId = String(event.user_id);
  const groupId = String(event.group_id || '');
  return executeRiskCommand({ event, ctx, raw, text, userId, groupId });
}
