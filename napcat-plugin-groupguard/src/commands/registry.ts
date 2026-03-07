import type { CommandRoute } from './types';
import { matchAuthCommand } from './modules/auth';
import { matchModerationCommand } from './modules/moderation';
import { matchInteractionCommand } from './modules/interaction';
import { matchRiskCommand } from './modules/risk';
import { matchQaCommand } from './modules/qa';
import { matchSystemCommand } from './modules/system';

export function resolveCommandRoute(text: string): CommandRoute {
  const auth = matchAuthCommand(text);
  if (auth) return { domain: 'auth', matchedBy: auth };
  const moderation = matchModerationCommand(text);
  if (moderation) return { domain: 'moderation', matchedBy: moderation };
  const interaction = matchInteractionCommand(text);
  if (interaction) return { domain: 'interaction', matchedBy: interaction };
  const risk = matchRiskCommand(text);
  if (risk) return { domain: 'risk', matchedBy: risk };
  const qa = matchQaCommand(text);
  if (qa) return { domain: 'qa', matchedBy: qa };
  const system = matchSystemCommand(text);
  if (system) return { domain: 'system', matchedBy: system };
  return { domain: 'unknown', matchedBy: '' };
}
