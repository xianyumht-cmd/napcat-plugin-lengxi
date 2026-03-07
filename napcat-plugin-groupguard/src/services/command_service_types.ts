import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';

export interface CommandExecutionContext {
  event: OB11Message;
  ctx: NapCatPluginContext;
  raw: string;
  text: string;
  userId: string;
  groupId: string;
}
