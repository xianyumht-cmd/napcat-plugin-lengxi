import type { ActivityRecord, SigninData, InviteData } from './types';
import { pluginState } from './state';
import { storageAdapter } from './storage_adapter';

// 内存缓存
const cache = {
    activity: new Map<string, Record<string, ActivityRecord>>(),
    signin: new Map<string, Record<string, SigninData>>(),
    invites: new Map<string, Record<string, InviteData>>(),
    warnings: new Map<string, Record<string, number>>(),
};

export async function initDB() {
    storageAdapter.init(pluginState.configDir);
}

function loadData<T>(type: keyof typeof cache, groupId: string): Record<string, T> {
    if (cache[type].has(groupId)) {
        return cache[type].get(groupId) as Record<string, T>;
    }
    let data: Record<string, T> = {} as Record<string, T>;
    if (type === 'activity') data = storageAdapter.getAllActivity(groupId) as Record<string, T>;
    else if (type === 'signin') data = storageAdapter.getAllSignin(groupId) as Record<string, T>;
    else if (type === 'invites') data = storageAdapter.getAllInvites(groupId) as Record<string, T>;
    else if (type === 'warnings') data = {} as Record<string, T>;
    cache[type].set(groupId, data);
    return data;
}

export const dbQuery = {
    // Activity
    getActivity: (groupId: string, userId: string): ActivityRecord | undefined => {
        return storageAdapter.getActivity(groupId, userId) as ActivityRecord | undefined;
    },
    
    getActivityAsync: async (groupId: string, userId: string): Promise<ActivityRecord | undefined> => {
        const data = loadData<ActivityRecord>('activity', groupId);
        if (!data[userId]) {
            const row = storageAdapter.getActivity(groupId, userId);
            if (row) {
                data[userId] = row;
            }
        }
        return data[userId] ? { ...data[userId] } : undefined;
    },

    updateActivity: async (groupId: string, userId: string, data: ActivityRecord) => {
        const allData = loadData<ActivityRecord>('activity', groupId);
        allData[userId] = data;
        storageAdapter.setActivity(groupId, userId, data);
    },

    getAllActivity: async (groupId: string): Promise<Record<string, ActivityRecord>> => {
        return { ...loadData<ActivityRecord>('activity', groupId) };
    },

    // Signin
    getSignin: async (groupId: string, userId: string): Promise<SigninData | undefined> => {
        const data = loadData<SigninData>('signin', groupId);
        if (!data[userId]) {
            const row = storageAdapter.getSignin(groupId, userId);
            if (row) data[userId] = row;
        }
        return data[userId] ? { ...data[userId] } : undefined;
    },
    updateSignin: async (groupId: string, userId: string, data: SigninData) => {
        const allData = loadData<SigninData>('signin', groupId);
        allData[userId] = data;
        storageAdapter.setSignin(groupId, userId, data);
    },
    getAllSignin: async (groupId: string): Promise<Record<string, SigninData>> => {
        return { ...loadData<SigninData>('signin', groupId) };
    },

    // Invites
    getInvite: async (groupId: string, userId: string): Promise<InviteData | undefined> => {
        const data = loadData<InviteData>('invites', groupId);
        if (!data[userId]) {
            const row = storageAdapter.getInvite(groupId, userId);
            if (row) data[userId] = row;
        }
        return data[userId] ? { ...data[userId] } : undefined;
    },
    updateInvite: async (groupId: string, userId: string, data: InviteData) => {
        const allData = loadData<InviteData>('invites', groupId);
        allData[userId] = data;
        storageAdapter.setInvite(groupId, userId, data);
    },
    getAllInvites: async (groupId: string): Promise<Record<string, InviteData>> => {
        return { ...loadData<InviteData>('invites', groupId) };
    },

    // Warnings
    getWarning: async (groupId: string, userId: string): Promise<number> => {
        const data = loadData<number>('warnings', groupId);
        if (data[userId] === undefined) data[userId] = storageAdapter.getWarning(groupId, userId);
        return data[userId] || 0;
    },
    setWarning: async (groupId: string, userId: string, count: number) => {
        const allData = loadData<number>('warnings', groupId);
        allData[userId] = count;
        storageAdapter.setWarning(groupId, userId, count);
    },
    runInTransaction: <T>(fn: () => T): T => storageAdapter.runInTransaction(fn)
};
