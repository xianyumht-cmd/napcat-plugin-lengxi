PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;

CREATE TABLE IF NOT EXISTS storage_meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS group_config (
  group_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_qa (
  group_id TEXT NOT NULL,
  keyword TEXT NOT NULL,
  mode TEXT NOT NULL,
  reply TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, keyword, mode)
);

CREATE TABLE IF NOT EXISTS activity (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  msg_count INTEGER NOT NULL DEFAULT 0,
  last_active INTEGER NOT NULL DEFAULT 0,
  msg_count_today INTEGER NOT NULL DEFAULT 0,
  last_active_day TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS signin (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_signin INTEGER NOT NULL DEFAULT 0,
  days INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  inviter_id TEXT NOT NULL DEFAULT '',
  invite_count INTEGER NOT NULL DEFAULT 0,
  invited_users_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS warnings (
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS join_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  passphrase_matched INTEGER NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_group_last_active ON activity(group_id, last_active DESC);
CREATE INDEX IF NOT EXISTS idx_signin_group_points ON signin(group_id, points DESC);
CREATE INDEX IF NOT EXISTS idx_join_logs_group_timestamp ON join_logs(group_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_warnings_group_count ON warnings(group_id, count DESC);
