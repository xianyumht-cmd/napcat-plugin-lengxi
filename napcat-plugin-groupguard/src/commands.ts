import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import { pluginState } from './state';
import { resolveCommandRoute } from './commands/registry';
import { handleAuthCommand } from './commands/modules/auth';
import { handleModerationCommand } from './commands/modules/moderation';
import { handleInteractionCommand } from './commands/modules/interaction';
import { handleRiskCommand } from './commands/modules/risk';
import { handleQaCommand } from './commands/modules/qa';
import { handleSystemCommand } from './commands/modules/system';
import { handleCommand as handleLegacyCommand } from './commands_legacy';

let USE_LEGACY_FALLBACK = true;

export { saveConfig } from './commands_legacy';
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
} from './commands_legacy';

export function setLegacyFallback(enabled: boolean): void {
  USE_LEGACY_FALLBACK = enabled;
  pluginState.log('info', `命令 Legacy Fallback 已${enabled ? '开启' : '关闭'}`);
}

export function getLegacyFallback(): boolean {
  return USE_LEGACY_FALLBACK;
}

export async function handleCommand(event: OB11Message, ctx: NapCatPluginContext): Promise<boolean> {
  const raw = event.raw_message || '';
  const text = raw.replace(/\[CQ:[^\]]+\]/g, '').trim();
  const route = resolveCommandRoute(text);
  if (route.domain !== 'unknown') {
    pluginState.debug(`命令路由: ${text} -> ${route.domain} (${route.matchedBy})`);
  }
  let handled = false;
  switch (route.domain) {
    case 'auth':
      handled = await handleAuthCommand(event, ctx);
      break;
    case 'moderation':
      handled = await handleModerationCommand(event, ctx);
      break;
    case 'interaction':
      handled = await handleInteractionCommand(event, ctx);
      break;
    case 'risk':
      handled = await handleRiskCommand(event, ctx);
      break;
    case 'qa':
      handled = await handleQaCommand(event, ctx);
      break;
    case 'system':
      handled = await handleSystemCommand(event, ctx);
      break;
    default:
      handled = false;
  }
  if (handled) return true;
  if (!USE_LEGACY_FALLBACK) return false;
  return handleLegacyCommand(event, ctx);
}
