import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from './state';
import { resolveCommandRoute } from './commands/registry';
import { AUTH_EXACT, AUTH_PREFIXES, handleAuthCommand, matchAuthCommand } from './commands/modules/auth';
import { MODERATION_EXACT, MODERATION_PREFIXES, handleModerationCommand, matchModerationCommand } from './commands/modules/moderation';
import { INTERACTION_EXACT, INTERACTION_PREFIXES, handleInteractionCommand, matchInteractionCommand } from './commands/modules/interaction';
import { RISK_EXACT, RISK_PREFIXES, handleRiskCommand, matchRiskCommand } from './commands/modules/risk';
import { QA_EXACT, QA_PREFIXES, handleQaCommand, matchQaCommand } from './commands/modules/qa';
import { SYSTEM_EXACT, SYSTEM_PREFIXES, handleSystemCommand, matchSystemCommand } from './commands/modules/system';
import type { RouteDomain } from './commands/command_validation';
import { validateCommandRouting } from './commands/command_validation';
export { saveConfig } from './commands/common';
export {
  handleAntiRecall,
  cacheMessage,
  handleEmojiReact,
  handleCardLockCheck,
  handleCardLockOnMessage,
  handleAutoRecall,
  sendWelcomeMessage,
  handleMsgTypeFilter,
  handleBlacklist,
  handleFilterKeywords,
  handleSpamDetect,
  handleQA,
  recordActivity
} from './commands/passive';

type CommandHandler = (event: OB11Message, ctx: NapCatPluginContext) => Promise<boolean>;

const ROUTE_HANDLERS: Record<RouteDomain, CommandHandler> = {
  auth: handleAuthCommand,
  moderation: handleModerationCommand,
  interaction: handleInteractionCommand,
  risk: handleRiskCommand,
  qa: handleQaCommand,
  system: handleSystemCommand
};

let commandValidationRan = false;

export function initCommandValidation(): void {
  if (commandValidationRan) return;
  commandValidationRan = true;
  const targets = [
    { domain: 'auth' as const, prefixes: AUTH_PREFIXES, exact: AUTH_EXACT, matcher: matchAuthCommand, handler: handleAuthCommand },
    { domain: 'moderation' as const, prefixes: MODERATION_PREFIXES, exact: MODERATION_EXACT, matcher: matchModerationCommand, handler: handleModerationCommand },
    { domain: 'interaction' as const, prefixes: INTERACTION_PREFIXES, exact: INTERACTION_EXACT, matcher: matchInteractionCommand, handler: handleInteractionCommand },
    { domain: 'risk' as const, prefixes: RISK_PREFIXES, exact: RISK_EXACT, matcher: matchRiskCommand, handler: handleRiskCommand },
    { domain: 'qa' as const, prefixes: QA_PREFIXES, exact: QA_EXACT, matcher: matchQaCommand, handler: handleQaCommand },
    { domain: 'system' as const, prefixes: SYSTEM_PREFIXES, exact: SYSTEM_EXACT, matcher: matchSystemCommand, handler: handleSystemCommand }
  ];
  const result = validateCommandRouting(targets, Object.keys(ROUTE_HANDLERS) as RouteDomain[]);
  for (const issue of result.issues) {
    pluginState.log('warn', `[CommandValidation][${issue.code}] ${issue.message}`);
  }
}

export async function handleCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  initCommandValidation();
  const route = resolveCommandRoute(text);
  if (route.domain !== 'unknown') {
    pluginState.debug(`命令路由: ${text} -> ${route.domain} (${route.matchedBy})`);
  }
  if (route.domain === 'unknown') return false;
  const handler = ROUTE_HANDLERS[route.domain];
  if (!handler) return false;
  return handler(event, ctx);
}
