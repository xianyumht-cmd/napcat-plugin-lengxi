// 类型定义

export interface PluginRule {
  name: string;
  enabled: boolean;
  suffix: string;
  replace: boolean;
  replaceText: string;
  /** 仅主人可触发该插件 */
  ownerOnly: boolean;
}

export interface QQBotPluginConfig {
  appid: string;
  secret: string;
  intents: string[];
  sandbox: boolean;
  qqNumber: string;
  imgMarkdownTemplateId: string;
  textMarkdownTemplateId: string;
  keyboardTemplateId: string;
  forceImageRehost: boolean;
  masterQQ: string;
}

export interface PluginConfig {
  enabled: boolean;
  globalSuffix: string;
  debug: boolean;
  rules: PluginRule[];
  qqbot?: QQBotPluginConfig;
  /** 全局主人QQ号（指令拦截用） */
  ownerQQ?: string;
}

export interface LogEntry {
  time: number;
  level: string;
  msg: string;
}

export interface PendingMessage {
  groupId: string;
  content: string;
  imageUrl?: string | null;
  imgWidth?: number;
  imgHeight?: number;
  rawMessage: any;
  code: string;
  timestamp: number;
  caller: string | null;
}

export interface PendingPbExtract {
  officialBotQQ: string;
  timestamp: number;
  code: string;
  groupOpenId: string;
}

export interface GroupButtonInfo {
  buttonId: string;
  callbackData: string;
  groupOpenId: string;
  updatedAt: number;
}

export interface GroupEventIdInfo {
  eventId: string;
  groupOpenId: string;
  timestamp: number;
}

export interface PendingContentInfo {
  content: string;
  imageUrl?: string | null;
  imgWidth?: number;
  imgHeight?: number;
  timestamp: number;
}

export interface ImageInfo {
  url?: string;
  file?: string;
  width?: number;
  height?: number;
}

/** 语音/视频媒体信息 */
export interface MediaInfo {
  type: 'record' | 'video';
  url?: string;
  file?: string;
}
