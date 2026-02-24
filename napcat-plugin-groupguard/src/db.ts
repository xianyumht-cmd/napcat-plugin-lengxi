import fs from 'fs';
import path from 'path';
import type { ActivityRecord, SigninData, InviteData } from './types';
import { pluginState } from './state';

// 内存缓存
const cache = {
    activity: new Map<string, Record<string, ActivityRecord>>(),
    signin: new Map<string, Record<string, SigninData>>(),
    invites: new Map<string, Record<string, InviteData>>(),
    warnings: new Map<string, Record<string, number>>(),
};

// 写入队列 (去抖动)
const writeQueue = new Set<string>();
let writeTimer: NodeJS.Timeout | null = null;
const WRITE_DELAY = 5000; // 5秒延迟写入

let dataDir = '';

export async function initDB() {
    // 确保数据目录存在
    dataDir = path.join(pluginState.configDir, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // 确保子目录存在
    ['activity', 'signin', 'invites', 'warnings'].forEach(sub => {
        const dir = path.join(dataDir, sub);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
    
    console.log('JSON DB v2.0 initialized at', dataDir);
}

// 通用加载函数 (带缓存)
function loadData<T>(type: keyof typeof cache, groupId: string): Record<string, T> {
    const key = `${type}:${groupId}`;
    if (cache[type].has(groupId)) {
        return cache[type].get(groupId) as Record<string, T>;
    }

    const filePath = path.join(dataDir, type, `${groupId}.json`);
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            cache[type].set(groupId, data);
            return data;
        }
    } catch (e) {
        console.error(`Failed to load ${type} data for group ${groupId}:`, e);
    }

    const empty = {};
    cache[type].set(groupId, empty);
    return empty;
}

// 触发写入 (原子操作 + 去抖动)
function scheduleWrite(type: keyof typeof cache, groupId: string) {
    const key = `${type}|${groupId}`;
    writeQueue.add(key);

    if (!writeTimer) {
        writeTimer = setTimeout(flushWrites, WRITE_DELAY);
    }
}

// 立即写入所有挂起的数据
function flushWrites() {
    if (writeTimer) {
        clearTimeout(writeTimer);
        writeTimer = null;
    }

    const queue = Array.from(writeQueue);
    writeQueue.clear();

    for (const item of queue) {
        const [type, groupId] = item.split('|') as [keyof typeof cache, string];
        const data = cache[type].get(groupId);
        if (!data) continue;

        const filePath = path.join(dataDir, type, `${groupId}.json`);
        const tempPath = `${filePath}.tmp`;

        try {
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf-8');
            fs.renameSync(tempPath, filePath); // 原子重命名，防止写入中断导致文件损坏
        } catch (e) {
            console.error(`Failed to write ${type} data for group ${groupId}:`, e);
        }
    }
}

// 定时保存 (双重保险)
setInterval(flushWrites, 60000);

export const dbQuery = {
    // Activity
    getActivity: (groupId: string, userId: string): ActivityRecord | undefined => {
        // 兼容异步接口，虽然这里是同步的，但为了不改 commands.ts 太多
        // 实际上 v2.0 JSON 是内存操作，速度极快
        return undefined as any; 
    },
    
    getActivityAsync: async (groupId: string, userId: string): Promise<ActivityRecord | undefined> => {
        const data = loadData<ActivityRecord>('activity', groupId);
        return data[userId] ? { ...data[userId] } : undefined;
    },

    updateActivity: async (groupId: string, userId: string, data: ActivityRecord) => {
        const allData = loadData<ActivityRecord>('activity', groupId);
        allData[userId] = data;
        scheduleWrite('activity', groupId);
    },

    getAllActivity: async (groupId: string): Promise<Record<string, ActivityRecord>> => {
        return { ...loadData<ActivityRecord>('activity', groupId) };
    },

    // Signin
    getSignin: async (groupId: string, userId: string): Promise<SigninData | undefined> => {
        const data = loadData<SigninData>('signin', groupId);
        return data[userId] ? { ...data[userId] } : undefined;
    },
    updateSignin: async (groupId: string, userId: string, data: SigninData) => {
        const allData = loadData<SigninData>('signin', groupId);
        allData[userId] = data;
        scheduleWrite('signin', groupId);
    },
    getAllSignin: async (groupId: string): Promise<Record<string, SigninData>> => {
        return { ...loadData<SigninData>('signin', groupId) };
    },

    // Invites
    getInvite: async (groupId: string, userId: string): Promise<InviteData | undefined> => {
        const data = loadData<InviteData>('invites', groupId);
        return data[userId] ? { ...data[userId] } : undefined;
    },
    updateInvite: async (groupId: string, userId: string, data: InviteData) => {
        const allData = loadData<InviteData>('invites', groupId);
        allData[userId] = data;
        scheduleWrite('invites', groupId);
    },
    getAllInvites: async (groupId: string): Promise<Record<string, InviteData>> => {
        return { ...loadData<InviteData>('invites', groupId) };
    },

    // Warnings
    getWarning: async (groupId: string, userId: string): Promise<number> => {
        const data = loadData<number>('warnings', groupId);
        return data[userId] || 0;
    },
    setWarning: async (groupId: string, userId: string, count: number) => {
        const allData = loadData<number>('warnings', groupId);
        allData[userId] = count;
        scheduleWrite('warnings', groupId);
    }
};
