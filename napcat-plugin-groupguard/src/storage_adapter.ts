import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type { GroupGuardSettings, JoinLogEntry } from './types';

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS storage_meta (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS group_config (group_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS group_qa (group_id TEXT NOT NULL, keyword TEXT NOT NULL, mode TEXT NOT NULL, reply TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (group_id, keyword, mode));
CREATE TABLE IF NOT EXISTS activity (group_id TEXT NOT NULL, user_id TEXT NOT NULL, msg_count INTEGER NOT NULL DEFAULT 0, last_active INTEGER NOT NULL DEFAULT 0, msg_count_today INTEGER NOT NULL DEFAULT 0, last_active_day TEXT NOT NULL DEFAULT '', PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS signin (group_id TEXT NOT NULL, user_id TEXT NOT NULL, last_signin INTEGER NOT NULL DEFAULT 0, days INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS invites (group_id TEXT NOT NULL, user_id TEXT NOT NULL, inviter_id TEXT NOT NULL DEFAULT '', invite_count INTEGER NOT NULL DEFAULT 0, invited_users_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS warnings (group_id TEXT NOT NULL, user_id TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (group_id, user_id));
CREATE TABLE IF NOT EXISTS join_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL, user_id TEXT NOT NULL, answer TEXT NOT NULL, passphrase_matched INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, timestamp INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_activity_group_last_active ON activity(group_id, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_signin_group_points ON signin(group_id, points DESC);
CREATE INDEX IF NOT EXISTS idx_join_logs_group_timestamp ON join_logs(group_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_warnings_group_count ON warnings(group_id, count DESC);
`;

type SqliteDb = any;

function toNumber(v: any, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function readJsonFile(filePath: string): any {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export class StorageAdapter {
  private db: SqliteDb | null = null;
  private inited = false;
  private dbPath = '';
  private dataDir = '';

  init(configDir: string): void {
    if (this.inited) return;
    this.dataDir = path.join(configDir, 'data');
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir, { recursive: true });
    this.dbPath = path.join(this.dataDir, 'groupguard.db');
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    this.inited = true;
  }

  private assertReady(): SqliteDb {
    if (!this.db) throw new Error('storage adapter not initialized');
    return this.db;
  }

  runInTransaction<T>(fn: () => T): T {
    const db = this.assertReady();
    db.exec('BEGIN IMMEDIATE');
    try {
      const ret = fn();
      db.exec('COMMIT');
      return ret;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  isMigrated(): boolean {
    const db = this.assertReady();
    const row = db.prepare('SELECT v FROM storage_meta WHERE k = ?').get('json_migrated');
    return !!row && String(row.v) === '1';
  }

  markMigrated(): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO storage_meta(k, v) VALUES (?, ?)').run('json_migrated', '1');
  }

  saveGroupConfig(groupId: string, cfg: GroupGuardSettings): void {
    const db = this.assertReady();
    const now = Date.now();
    const qaList = Array.isArray((cfg as any).qaList) ? (cfg as any).qaList : [];
    const configToSave: any = { ...(cfg as any) };
    delete configToSave.qaList;
    this.runInTransaction(() => {
      db.prepare('INSERT OR REPLACE INTO group_config(group_id, config_json, updated_at) VALUES (?, ?, ?)').run(groupId, JSON.stringify(configToSave), now);
      db.prepare('DELETE FROM group_qa WHERE group_id = ?').run(groupId);
      const stmt = db.prepare('INSERT OR REPLACE INTO group_qa(group_id, keyword, mode, reply, updated_at) VALUES (?, ?, ?, ?, ?)');
      for (const qa of qaList) {
        stmt.run(groupId, String(qa.keyword || ''), String(qa.mode || 'exact'), String(qa.reply || ''), now);
      }
    });
  }

  saveGroupConfigs(groups: Record<string, GroupGuardSettings>): void {
    const keys = Object.keys(groups || {});
    for (const gid of keys) {
      const cfg = groups[gid];
      if (cfg) this.saveGroupConfig(gid, cfg);
    }
  }

  loadAllGroupConfigs(): Record<string, GroupGuardSettings> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT group_id, config_json FROM group_config').all();
    const qaRows = db.prepare('SELECT group_id, keyword, mode, reply FROM group_qa').all();
    const qaMap = new Map<string, any[]>();
    for (const row of qaRows) {
      const list = qaMap.get(String(row.group_id)) || [];
      list.push({ keyword: String(row.keyword || ''), mode: String(row.mode || 'exact'), reply: String(row.reply || '') });
      qaMap.set(String(row.group_id), list);
    }
    const result: Record<string, GroupGuardSettings> = {};
    for (const row of rows) {
      const gid = String(row.group_id);
      let cfg: any = {};
      try {
        cfg = JSON.parse(String(row.config_json || '{}'));
      } catch {
        cfg = {};
      }
      cfg.qaList = qaMap.get(gid) || [];
      result[gid] = cfg as GroupGuardSettings;
    }
    return result;
  }

  migrateFromJson(configDir: string, groupsFromConfig: Record<string, GroupGuardSettings>): void {
    if (this.isMigrated()) return;
    const groupsDir = path.join(configDir, 'data', 'groups');
    const runChunk = (fn: () => void) => this.runInTransaction(fn);
    if (groupsFromConfig && Object.keys(groupsFromConfig).length) {
      this.saveGroupConfigs(groupsFromConfig);
    }
    if (fs.existsSync(groupsDir)) {
      const groupIds = fs.readdirSync(groupsDir).filter(n => fs.statSync(path.join(groupsDir, n)).isDirectory());
      for (const gid of groupIds) {
        const groupPath = path.join(groupsDir, gid);
        const cfg = readJsonFile(path.join(groupPath, 'config.json')) || {};
        const qa = readJsonFile(path.join(groupPath, 'qa.json')) || [];
        cfg.qaList = qa;
        this.saveGroupConfig(gid, cfg);
        const activity = readJsonFile(path.join(groupPath, 'activity.json')) || {};
        const signin = readJsonFile(path.join(groupPath, 'signin.json')) || {};
        const invites = readJsonFile(path.join(groupPath, 'invites.json')) || {};
        const warnings = readJsonFile(path.join(groupPath, 'warnings.json')) || {};
        const joinLogs = readJsonFile(path.join(groupPath, 'join_logs.json')) || [];
        this.importActivity(gid, activity, runChunk);
        this.importSignin(gid, signin, runChunk);
        this.importInvites(gid, invites, runChunk);
        this.importWarnings(gid, warnings, runChunk);
        this.importJoinLogs(gid, joinLogs, runChunk);
      }
    }
    this.markMigrated();
  }

  private importActivity(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO activity(group_id, user_id, msg_count, last_active, msg_count_today, last_active_day) VALUES (?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, toNumber((v as any).msgCount, 0), toNumber((v as any).lastActive, 0), toNumber((v as any).msgCountToday ?? (v as any).todayCount, 0), String((v as any).lastActiveDay ?? (v as any).todayDate ?? ''));
        }
      });
    }
  }

  private importSignin(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO signin(group_id, user_id, last_signin, days, points) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, toNumber((v as any).lastSignin ?? (v as any).lastSigninTime, 0), toNumber((v as any).days ?? (v as any).streak, 0), toNumber((v as any).points, 0));
        }
      });
    }
  }

  private importInvites(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO invites(group_id, user_id, inviter_id, invite_count, invited_users_json) VALUES (?, ?, ?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, String((v as any).inviterId || ''), toNumber((v as any).inviteCount, 0), JSON.stringify((v as any).invitedUsers || []));
        }
      });
    }
  }

  private importWarnings(groupId: string, data: Record<string, any>, tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const entries = Object.entries(data || {});
    const stmt = db.prepare('INSERT OR REPLACE INTO warnings(group_id, user_id, count) VALUES (?, ?, ?)');
    for (let i = 0; i < entries.length; i += 500) {
      const chunk = entries.slice(i, i + 500);
      tx(() => {
        for (const [userId, v] of chunk) {
          stmt.run(groupId, userId, toNumber(v, 0));
        }
      });
    }
  }

  private importJoinLogs(groupId: string, rows: any[], tx: (fn: () => void) => void): void {
    const db = this.assertReady();
    const list = Array.isArray(rows) ? rows : [];
    const stmt = db.prepare('INSERT INTO join_logs(group_id, user_id, answer, passphrase_matched, action, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500);
      tx(() => {
        for (const r of chunk) {
          stmt.run(groupId, String(r.userId || ''), String(r.answer || ''), r.passphraseMatched ? 1 : 0, String(r.action || 'reject'), String(r.reason || ''), toNumber(r.timestamp, Date.now()));
        }
      });
    }
  }

  getActivity(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare('SELECT msg_count, last_active, msg_count_today, last_active_day FROM activity WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!row) return undefined;
    return { msgCount: toNumber(row.msg_count, 0), lastActive: toNumber(row.last_active, 0), msgCountToday: toNumber(row.msg_count_today, 0), lastActiveDay: String(row.last_active_day || '') };
  }

  setActivity(groupId: string, userId: string, data: any): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO activity(group_id, user_id, msg_count, last_active, msg_count_today, last_active_day) VALUES (?, ?, ?, ?, ?, ?)').run(
      groupId,
      userId,
      toNumber(data?.msgCount, 0),
      toNumber(data?.lastActive, 0),
      toNumber(data?.msgCountToday ?? data?.todayCount, 0),
      String(data?.lastActiveDay ?? data?.todayDate ?? '')
    );
  }

  getAllActivity(groupId: string): Record<string, any> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT user_id, msg_count, last_active, msg_count_today, last_active_day FROM activity WHERE group_id = ?').all(groupId);
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[String(r.user_id)] = { msgCount: toNumber(r.msg_count, 0), lastActive: toNumber(r.last_active, 0), msgCountToday: toNumber(r.msg_count_today, 0), lastActiveDay: String(r.last_active_day || '') };
    }
    return out;
  }

  getSignin(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare('SELECT last_signin, days, points FROM signin WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!row) return undefined;
    return { lastSignin: toNumber(row.last_signin, 0), days: toNumber(row.days, 0), points: toNumber(row.points, 0) };
  }

  setSignin(groupId: string, userId: string, data: any): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO signin(group_id, user_id, last_signin, days, points) VALUES (?, ?, ?, ?, ?)').run(
      groupId,
      userId,
      toNumber(data?.lastSignin ?? data?.lastSigninTime, 0),
      toNumber(data?.days ?? data?.streak, 0),
      toNumber(data?.points, 0)
    );
  }

  getAllSignin(groupId: string): Record<string, any> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT user_id, last_signin, days, points FROM signin WHERE group_id = ?').all(groupId);
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[String(r.user_id)] = { lastSignin: toNumber(r.last_signin, 0), days: toNumber(r.days, 0), points: toNumber(r.points, 0) };
    }
    return out;
  }

  getInvite(groupId: string, userId: string): any {
    const db = this.assertReady();
    const row = db.prepare('SELECT inviter_id, invite_count, invited_users_json FROM invites WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    if (!row) return undefined;
    return { inviterId: String(row.inviter_id || ''), inviteCount: toNumber(row.invite_count, 0), invitedUsers: JSON.parse(String(row.invited_users_json || '[]')) };
  }

  setInvite(groupId: string, userId: string, data: any): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO invites(group_id, user_id, inviter_id, invite_count, invited_users_json) VALUES (?, ?, ?, ?, ?)').run(
      groupId,
      userId,
      String(data?.inviterId || ''),
      toNumber(data?.inviteCount, 0),
      JSON.stringify(data?.invitedUsers || [])
    );
  }

  getAllInvites(groupId: string): Record<string, any> {
    const db = this.assertReady();
    const rows = db.prepare('SELECT user_id, inviter_id, invite_count, invited_users_json FROM invites WHERE group_id = ?').all(groupId);
    const out: Record<string, any> = {};
    for (const r of rows) {
      out[String(r.user_id)] = { inviterId: String(r.inviter_id || ''), inviteCount: toNumber(r.invite_count, 0), invitedUsers: JSON.parse(String(r.invited_users_json || '[]')) };
    }
    return out;
  }

  getWarning(groupId: string, userId: string): number {
    const db = this.assertReady();
    const row = db.prepare('SELECT count FROM warnings WHERE group_id = ? AND user_id = ?').get(groupId, userId);
    return row ? toNumber(row.count, 0) : 0;
  }

  setWarning(groupId: string, userId: string, count: number): void {
    const db = this.assertReady();
    db.prepare('INSERT OR REPLACE INTO warnings(group_id, user_id, count) VALUES (?, ?, ?)').run(groupId, userId, toNumber(count, 0));
  }

  insertJoinLog(entry: JoinLogEntry): void {
    const db = this.assertReady();
    db.prepare('INSERT INTO join_logs(group_id, user_id, answer, passphrase_matched, action, reason, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      String(entry.groupId || ''),
      String(entry.userId || ''),
      String(entry.answer || ''),
      entry.passphraseMatched ? 1 : 0,
      String(entry.action || 'reject'),
      String(entry.reason || ''),
      toNumber(entry.timestamp, Date.now())
    );
  }

  getStorageStatus(): { migrated: boolean; dbPath: string; tableCounts: Record<string, number>; } {
    const db = this.assertReady();
    const tables = ['group_config', 'group_qa', 'activity', 'signin', 'invites', 'warnings', 'join_logs'];
    const tableCounts: Record<string, number> = {};
    for (const t of tables) {
      const row = db.prepare(`SELECT COUNT(1) AS c FROM ${t}`).get();
      tableCounts[t] = toNumber(row?.c, 0);
    }
    return { migrated: this.isMigrated(), dbPath: this.dbPath, tableCounts };
  }
}

export const storageAdapter = new StorageAdapter();
