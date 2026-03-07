import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import {
  executeCacheMessage,
  executeHandleAntiRecall,
  executeHandleAutoRecall,
  executeHandleBlacklist,
  executeHandleCardLockCheck,
  executeHandleCardLockOnMessage,
  executeHandleEmojiReact,
  executeHandleFilterKeywords,
  executeHandleMsgTypeFilter,
  executeHandleQA,
  executeHandleSpamDetect,
  executeRecordActivity,
  executeSendWelcomeMessage
} from '../services/passive_service';

export async function handleAntiRecall(groupId: string, messageId: string, operatorId: string): Promise<void> {
  await executeHandleAntiRecall(groupId, messageId, operatorId);
}

export function cacheMessage(messageId: string, userId: string, groupId: string, raw: string, segments?: any[]): void {
  executeCacheMessage(messageId, userId, groupId, raw, segments);
}

export async function handleEmojiReact(groupId: string, userId: string, messageId: string, selfId: string): Promise<void> {
  await executeHandleEmojiReact(groupId, userId, messageId, selfId);
}

export async function handleCardLockCheck(groupId: string, userId: string): Promise<void> {
  await executeHandleCardLockCheck(groupId, userId);
}

export async function handleCardLockOnMessage(groupId: string, userId: string, senderCard: string): Promise<void> {
  await executeHandleCardLockOnMessage(groupId, userId, senderCard);
}

export async function handleAutoRecall(groupId: string, userId: string, messageId: string): Promise<boolean> {
  return executeHandleAutoRecall(groupId, userId, messageId);
}

export async function sendWelcomeMessage(groupId: string, userId: string): Promise<void> {
  await executeSendWelcomeMessage(groupId, userId);
}

export async function handleMsgTypeFilter(groupId: string, userId: string, messageId: string, raw: string, messageSegments: any[]): Promise<boolean> {
  return executeHandleMsgTypeFilter(groupId, userId, messageId, raw, messageSegments);
}

export async function handleBlacklist(groupId: string, userId: string, messageId: string): Promise<boolean> {
  return executeHandleBlacklist(groupId, userId, messageId);
}

export async function handleFilterKeywords(groupId: string, userId: string, messageId: string, raw: string, ctx: NapCatPluginContext): Promise<boolean> {
  return executeHandleFilterKeywords(groupId, userId, messageId, raw, ctx);
}

export async function handleSpamDetect(groupId: string, userId: string, raw: string = ''): Promise<boolean> {
  return executeHandleSpamDetect(groupId, userId, raw);
}

export async function handleQA(groupId: string, userId: string, raw: string): Promise<boolean> {
  return executeHandleQA(groupId, userId, raw);
}

export async function recordActivity(groupId: string, userId: string): Promise<void> {
  await executeRecordActivity(groupId, userId);
}
