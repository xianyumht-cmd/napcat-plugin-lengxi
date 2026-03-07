import type { ActivityRecord, SigninData, InviteData } from '../types';
import { dbQuery } from '../db';

const get = {
  warning(groupId: string, userId: string): Promise<number> {
    return dbQuery.getWarning(groupId, userId);
  },
  signin(groupId: string, userId: string): Promise<SigninData | undefined> {
    return dbQuery.getSignin(groupId, userId);
  },
  allSignin(groupId: string): Promise<Record<string, SigninData>> {
    return dbQuery.getAllSignin(groupId);
  },
  invite(groupId: string, userId: string): Promise<InviteData | undefined> {
    return dbQuery.getInvite(groupId, userId);
  },
  allInvites(groupId: string): Promise<Record<string, InviteData>> {
    return dbQuery.getAllInvites(groupId);
  },
  activity(groupId: string, userId: string): Promise<ActivityRecord | undefined> {
    return dbQuery.getActivityAsync(groupId, userId);
  },
  allActivity(groupId: string): Promise<Record<string, ActivityRecord>> {
    return dbQuery.getAllActivity(groupId);
  }
};

const update = {
  warning(groupId: string, userId: string, count: number): Promise<void> {
    return dbQuery.setWarning(groupId, userId, count);
  },
  signin(groupId: string, userId: string, data: SigninData): Promise<void> {
    return dbQuery.updateSignin(groupId, userId, data);
  },
  invite(groupId: string, userId: string, data: InviteData): Promise<void> {
    return dbQuery.updateInvite(groupId, userId, data);
  },
  activity(groupId: string, userId: string, data: ActivityRecord): Promise<void> {
    return dbQuery.updateActivity(groupId, userId, data);
  }
};

const insert = {
  signin(groupId: string, userId: string, data: SigninData): Promise<void> {
    return dbQuery.updateSignin(groupId, userId, data);
  },
  invite(groupId: string, userId: string, data: InviteData): Promise<void> {
    return dbQuery.updateInvite(groupId, userId, data);
  },
  activity(groupId: string, userId: string, data: ActivityRecord): Promise<void> {
    return dbQuery.updateActivity(groupId, userId, data);
  }
};

const del = {
  warning(groupId: string, userId: string): Promise<void> {
    return dbQuery.setWarning(groupId, userId, 0);
  }
};

export const groupguardRepository = {
  get,
  update,
  insert,
  delete: del,
  getWarning(groupId: string, userId: string): Promise<number> {
    return get.warning(groupId, userId);
  },
  setWarning(groupId: string, userId: string, count: number): Promise<void> {
    return update.warning(groupId, userId, count);
  },
  getSignin(groupId: string, userId: string): Promise<SigninData | undefined> {
    return get.signin(groupId, userId);
  },
  updateSignin(groupId: string, userId: string, data: SigninData): Promise<void> {
    return update.signin(groupId, userId, data);
  },
  getAllSignin(groupId: string): Promise<Record<string, SigninData>> {
    return get.allSignin(groupId);
  },
  getInvite(groupId: string, userId: string): Promise<InviteData | undefined> {
    return get.invite(groupId, userId);
  },
  updateInvite(groupId: string, userId: string, data: InviteData): Promise<void> {
    return update.invite(groupId, userId, data);
  },
  getAllInvites(groupId: string): Promise<Record<string, InviteData>> {
    return get.allInvites(groupId);
  },
  getActivityAsync(groupId: string, userId: string): Promise<ActivityRecord | undefined> {
    return get.activity(groupId, userId);
  },
  updateActivity(groupId: string, userId: string, data: ActivityRecord): Promise<void> {
    return update.activity(groupId, userId, data);
  },
  getAllActivity(groupId: string): Promise<Record<string, ActivityRecord>> {
    return get.allActivity(groupId);
  },
  runInTransaction<T>(fn: () => T): T {
    return dbQuery.runInTransaction(fn);
  }
};
