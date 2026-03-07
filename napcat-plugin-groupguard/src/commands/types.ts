export type CommandDomain = 'auth' | 'moderation' | 'interaction' | 'risk' | 'qa' | 'system' | 'unknown';

export interface CommandRoute {
  domain: CommandDomain;
  matchedBy: string;
}
