import Database from 'better-sqlite3';
import path from 'path';
import type { ActivityRecord, SigninData, InviteData } from './types';

let db: Database.Database;

export function initDB(configDir: string) {
  const dbPath = path.join(configDir, 'data.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      group_id TEXT,
      user_id TEXT,
      msg_count INTEGER DEFAULT 0,
      last_active INTEGER DEFAULT 0,
      role TEXT DEFAULT 'member',
      msg_count_today INTEGER DEFAULT 0,
      last_active_day TEXT,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS signin (
      group_id TEXT,
      user_id TEXT,
      days INTEGER DEFAULT 0,
      last_signin INTEGER DEFAULT 0,
      points INTEGER DEFAULT 0,
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS invites (
      group_id TEXT,
      user_id TEXT,
      inviter_id TEXT,
      invite_count INTEGER DEFAULT 0,
      join_time INTEGER,
      PRIMARY KEY (group_id, user_id)
    );
    
    CREATE TABLE IF NOT EXISTS warnings (
        group_id TEXT,
        user_id TEXT,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, user_id)
    );
  `);
}

export const dbQuery = {
    // Activity
    getActivity: (groupId: string, userId: string): ActivityRecord | undefined => {
        const row = db.prepare('SELECT * FROM activity WHERE group_id = ? AND user_id = ?').get(groupId, userId) as any;
        if (!row) return undefined;
        return {
            msgCount: row.msg_count,
            lastActive: row.last_active,
            role: row.role,
            msgCountToday: row.msg_count_today,
            lastActiveDay: row.last_active_day
        };
    },
    updateActivity: (groupId: string, userId: string, data: ActivityRecord) => {
        db.prepare(`
            INSERT INTO activity (group_id, user_id, msg_count, last_active, role, msg_count_today, last_active_day)
            VALUES (@groupId, @userId, @msgCount, @lastActive, @role, @msgCountToday, @lastActiveDay)
            ON CONFLICT(group_id, user_id) DO UPDATE SET
            msg_count = @msgCount,
            last_active = @lastActive,
            role = @role,
            msg_count_today = @msgCountToday,
            last_active_day = @lastActiveDay
        `).run({
            groupId, userId,
            msgCount: data.msgCount,
            lastActive: data.lastActive,
            role: data.role,
            msgCountToday: data.msgCountToday || 0,
            lastActiveDay: data.lastActiveDay || ''
        });
    },
    getAllActivity: (groupId: string): Record<string, ActivityRecord> => {
        const rows = db.prepare('SELECT * FROM activity WHERE group_id = ?').all(groupId) as any[];
        const res: Record<string, ActivityRecord> = {};
        for (const row of rows) {
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
    getSignin: (groupId: string, userId: string): SigninData | undefined => {
        const row = db.prepare('SELECT * FROM signin WHERE group_id = ? AND user_id = ?').get(groupId, userId) as any;
        if (!row) return undefined;
        return {
            days: row.days,
            lastSignin: row.last_signin,
            points: row.points
        };
    },
    updateSignin: (groupId: string, userId: string, data: SigninData) => {
        db.prepare(`
            INSERT INTO signin (group_id, user_id, days, last_signin, points)
            VALUES (@groupId, @userId, @days, @lastSignin, @points)
            ON CONFLICT(group_id, user_id) DO UPDATE SET
            days = @days,
            last_signin = @lastSignin,
            points = @points
        `).run({
            groupId, userId,
            days: data.days,
            lastSignin: data.lastSignin,
            points: data.points
        });
    },
    getAllSignin: (groupId: string): Record<string, SigninData> => {
        const rows = db.prepare('SELECT * FROM signin WHERE group_id = ?').all(groupId) as any[];
        const res: Record<string, SigninData> = {};
        for (const row of rows) {
            res[row.user_id] = {
                days: row.days,
                lastSignin: row.last_signin,
                points: row.points
            };
        }
        return res;
    },

    // Invites
    getInvite: (groupId: string, userId: string): InviteData | undefined => {
        const row = db.prepare('SELECT * FROM invites WHERE group_id = ? AND user_id = ?').get(groupId, userId) as any;
        if (!row) return undefined;
        return {
            inviterId: row.inviter_id || undefined,
            inviteCount: row.invite_count,
            joinTime: row.join_time
        };
    },
    updateInvite: (groupId: string, userId: string, data: InviteData) => {
        db.prepare(`
            INSERT INTO invites (group_id, user_id, inviter_id, invite_count, join_time)
            VALUES (@groupId, @userId, @inviterId, @inviteCount, @joinTime)
            ON CONFLICT(group_id, user_id) DO UPDATE SET
            inviter_id = @inviterId,
            invite_count = @inviteCount,
            join_time = @joinTime
        `).run({
            groupId, userId,
            inviterId: data.inviterId || null,
            inviteCount: data.inviteCount,
            joinTime: data.joinTime
        });
    },
    getAllInvites: (groupId: string): Record<string, InviteData> => {
        const rows = db.prepare('SELECT * FROM invites WHERE group_id = ?').all(groupId) as any[];
        const res: Record<string, InviteData> = {};
        for (const row of rows) {
            res[row.user_id] = {
                inviterId: row.inviter_id || undefined,
                inviteCount: row.invite_count,
                joinTime: row.join_time
            };
        }
        return res;
    },

    // Warnings
    getWarning: (groupId: string, userId: string): number => {
        const row = db.prepare('SELECT count FROM warnings WHERE group_id = ? AND user_id = ?').get(groupId, userId) as any;
        return row ? row.count : 0;
    },
    setWarning: (groupId: string, userId: string, count: number) => {
        if (count === 0) {
            db.prepare('DELETE FROM warnings WHERE group_id = ? AND user_id = ?').run(groupId, userId);
        } else {
            db.prepare(`
                INSERT INTO warnings (group_id, user_id, count) VALUES (?, ?, ?)
                ON CONFLICT(group_id, user_id) DO UPDATE SET count = ?
            `).run(groupId, userId, count, count);
        }
    }
};
