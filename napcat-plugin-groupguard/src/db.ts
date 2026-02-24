import mysql from 'mysql2/promise';
import type { ActivityRecord, SigninData, InviteData } from './types';
import { pluginState } from './state';

let pool: mysql.Pool;

export async function initDB() {
  const config = pluginState.config.mysql;
  if (!config) {
      console.error('MySQL 配置缺失');
      return;
  }

  pool = mysql.createPool({
    host: config.host || '127.0.0.1',
    port: config.port || 3306,
    user: config.user || 'root',
    password: config.password || '',
    database: config.database || 'napcat_groupguard',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });

  try {
      // 检查连接
      const conn = await pool.getConnection();
      console.log('MySQL 连接成功');
      conn.release();

      // 初始化表结构
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS activity (
          group_id VARCHAR(32),
          user_id VARCHAR(32),
          msg_count INT DEFAULT 0,
          last_active BIGINT DEFAULT 0,
          role VARCHAR(20) DEFAULT 'member',
          msg_count_today INT DEFAULT 0,
          last_active_day VARCHAR(20),
          PRIMARY KEY (group_id, user_id)
        )
      `);

      await pool.execute(`
        CREATE TABLE IF NOT EXISTS signin (
          group_id VARCHAR(32),
          user_id VARCHAR(32),
          days INT DEFAULT 0,
          last_signin BIGINT DEFAULT 0,
          points INT DEFAULT 0,
          PRIMARY KEY (group_id, user_id)
        )
      `);

      await pool.execute(`
        CREATE TABLE IF NOT EXISTS invites (
          group_id VARCHAR(32),
          user_id VARCHAR(32),
          inviter_id VARCHAR(32),
          invite_count INT DEFAULT 0,
          join_time BIGINT,
          PRIMARY KEY (group_id, user_id)
        )
      `);
      
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS warnings (
            group_id VARCHAR(32),
            user_id VARCHAR(32),
            count INT DEFAULT 0,
            PRIMARY KEY (group_id, user_id)
        )
      `);
  } catch (err) {
      console.error('MySQL 初始化失败:', err);
  }
}

// 辅助函数：执行查询并返回第一行
async function getOne<T>(sql: string, params: any[]): Promise<T | undefined> {
    try {
        const [rows] = await pool.execute(sql, params);
        return (rows as any[])[0] as T;
    } catch (e) {
        console.error('DB Error:', e);
        return undefined;
    }
}

// 辅助函数：执行写入
async function execute(sql: string, params: any[]) {
    try {
        await pool.execute(sql, params);
    } catch (e) {
        console.error('DB Error:', e);
    }
}

export const dbQuery = {
    // Activity
    getActivity: (groupId: string, userId: string): ActivityRecord | undefined => {
        // 同步方法无法直接调用 async DB，这里需要修改调用逻辑或使用缓存
        // 鉴于架构变更较大，我们暂时使用 "Fire-and-Forget" 或 简单的 Promise 包装
        // 但为了兼容旧代码同步调用，这里必须返回 Promise，或者重构 commands.ts 为全异步
        // 修正：dbQuery 方法全部改为 async，并在 commands.ts 中 await
        return undefined as any; // 占位，实际在 commands.ts 中并未严格要求同步，但部分逻辑可能需要调整
    },
    
    // 实际的异步实现
    getActivityAsync: async (groupId: string, userId: string): Promise<ActivityRecord | undefined> => {
        const row = await getOne<any>('SELECT * FROM activity WHERE group_id = ? AND user_id = ?', [groupId, userId]);
        if (!row) return undefined;
        return {
            msgCount: row.msg_count,
            lastActive: row.last_active,
            role: row.role,
            msgCountToday: row.msg_count_today,
            lastActiveDay: row.last_active_day
        };
    },

    updateActivity: async (groupId: string, userId: string, data: ActivityRecord) => {
        await execute(`
            INSERT INTO activity (group_id, user_id, msg_count, last_active, role, msg_count_today, last_active_day)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            msg_count = VALUES(msg_count),
            last_active = VALUES(last_active),
            role = VALUES(role),
            msg_count_today = VALUES(msg_count_today),
            last_active_day = VALUES(last_active_day)
        `, [groupId, userId, data.msgCount, data.lastActive, data.role, data.msgCountToday || 0, data.lastActiveDay || '']);
    },

    getAllActivity: async (groupId: string): Promise<Record<string, ActivityRecord>> => {
        const [rows] = await pool.execute('SELECT * FROM activity WHERE group_id = ?', [groupId]);
        const res: Record<string, ActivityRecord> = {};
        for (const row of (rows as any[])) {
            res[row.user_id] = {
                msgCount: row.msg_count,
                lastActive: row.last_active,
                role: row.role,
                msgCountToday: row.msg_count_today,
                lastActiveDay: row.last_active_day
            };
        }
        return res;
    },

    // Signin
    getSignin: async (groupId: string, userId: string): Promise<SigninData | undefined> => {
        const row = await getOne<any>('SELECT * FROM signin WHERE group_id = ? AND user_id = ?', [groupId, userId]);
        if (!row) return undefined;
        return {
            days: row.days,
            lastSignin: row.last_signin,
            points: row.points
        };
    },
    updateSignin: async (groupId: string, userId: string, data: SigninData) => {
        await execute(`
            INSERT INTO signin (group_id, user_id, days, last_signin, points)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            days = VALUES(days),
            last_signin = VALUES(last_signin),
            points = VALUES(points)
        `, [groupId, userId, data.days, data.lastSignin, data.points]);
    },
    getAllSignin: async (groupId: string): Promise<Record<string, SigninData>> => {
        const [rows] = await pool.execute('SELECT * FROM signin WHERE group_id = ?', [groupId]);
        const res: Record<string, SigninData> = {};
        for (const row of (rows as any[])) {
            res[row.user_id] = {
                days: row.days,
                lastSignin: row.last_signin,
                points: row.points
            };
        }
        return res;
    },

    // Invites
    getInvite: async (groupId: string, userId: string): Promise<InviteData | undefined> => {
        const row = await getOne<any>('SELECT * FROM invites WHERE group_id = ? AND user_id = ?', [groupId, userId]);
        if (!row) return undefined;
        return {
            inviterId: row.inviter_id,
            inviteCount: row.invite_count,
            joinTime: row.join_time
        };
    },
    updateInvite: async (groupId: string, userId: string, data: InviteData) => {
        await execute(`
            INSERT INTO invites (group_id, user_id, inviter_id, invite_count, join_time)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            inviter_id = VALUES(inviter_id),
            invite_count = VALUES(invite_count),
            join_time = VALUES(join_time)
        `, [groupId, userId, data.inviterId || '', data.inviteCount, data.joinTime || 0]);
    },
    getAllInvites: async (groupId: string): Promise<Record<string, InviteData>> => {
        const [rows] = await pool.execute('SELECT * FROM invites WHERE group_id = ?', [groupId]);
        const res: Record<string, InviteData> = {};
        for (const row of (rows as any[])) {
            res[row.user_id] = {
                inviterId: row.inviter_id,
                inviteCount: row.invite_count,
                joinTime: row.join_time
            };
        }
        return res;
    },

    // Warnings
    getWarning: async (groupId: string, userId: string): Promise<number> => {
        const row = await getOne<any>('SELECT count FROM warnings WHERE group_id = ? AND user_id = ?', [groupId, userId]);
        return row ? row.count : 0;
    },
    setWarning: async (groupId: string, userId: string, count: number) => {
        await execute(`
            INSERT INTO warnings (group_id, user_id, count)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE count = VALUES(count)
        `, [groupId, userId, count]);
    }
};
