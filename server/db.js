import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// 数据库文件默认 server/data/campus.db（已加入 .gitignore）
const dbPath = process.env.DB_PATH || path.join(dataDir, 'campus.db');
export const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 统一用 ISO 字符串存时间，前端可直接 new Date() 解析
export const nowIso = () => new Date().toISOString();

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname   TEXT    NOT NULL,
      college    TEXT    NOT NULL DEFAULT '',
      avatar     TEXT    NOT NULL DEFAULT '🎓',
      exp        INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campuses (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT    NOT NULL,
      slug TEXT    NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS areas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campus_id   INTEGER NOT NULL,
      name        TEXT    NOT NULL,
      slug        TEXT    NOT NULL UNIQUE,
      description TEXT    NOT NULL DEFAULT '',
      x           REAL    NOT NULL DEFAULT 0,
      y           REAL    NOT NULL DEFAULT 0,
      color       TEXT    NOT NULL DEFAULT '#5bc49a',
      emoji       TEXT    NOT NULL DEFAULT '📍',
      hidden      INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (campus_id) REFERENCES campuses(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS channels (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      area_id INTEGER NOT NULL,
      name    TEXT    NOT NULL,
      FOREIGN KEY (area_id) REFERENCES areas(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id  INTEGER NOT NULL,
      user_id     INTEGER NOT NULL,
      post_id     INTEGER,
      type        TEXT    NOT NULL DEFAULT 'text',
      content     TEXT    NOT NULL,
      reply_to    TEXT,
      mentions    TEXT,
      recalled_at TEXT,
      recalled_by INTEGER,
      created_at  TEXT    NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS posts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      title      TEXT    NOT NULL,
      content    TEXT    NOT NULL DEFAULT '',
      category   TEXT    NOT NULL DEFAULT '综合',
      status     TEXT    NOT NULL DEFAULT 'open',
      created_at TEXT    NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );

    -- 活动帖的参与者（报名/加入）。发起人视为默认参与者（不重复入库）。
    -- 权限：仅参与者可在该活动的专属讨论区发言，其余人只读。
    CREATE TABLE IF NOT EXISTS post_participants (
      post_id    INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      created_at TEXT    NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 活动备注（管理员维护；visible_to_participants 决定是否对参与者可见）
    CREATE TABLE IF NOT EXISTS post_notes (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id                 INTEGER NOT NULL,
      content                 TEXT    NOT NULL,
      created_by              INTEGER NOT NULL,
      created_at              TEXT    NOT NULL,
      visible_to_participants INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (post_id)    REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 活动操作日志（状态变更等，记录操作人/时间/旧值/新值）
    CREATE TABLE IF NOT EXISTS post_operation_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id     INTEGER NOT NULL,
      operator_id INTEGER NOT NULL,
      action      TEXT    NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      created_at  TEXT    NOT NULL,
      FOREIGN KEY (post_id)     REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 消息表情回应（同一用户同一 emoji 只计一次）
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER NOT NULL,
      emoji      TEXT    NOT NULL,
      user_id    INTEGER NOT NULL,
      created_at TEXT    NOT NULL,
      PRIMARY KEY (message_id, emoji, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );

    -- 消息已读（readBy）
    CREATE TABLE IF NOT EXISTS message_reads (
      message_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      read_at    TEXT    NOT NULL,
      PRIMARY KEY (message_id, user_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
    );

    -- 自定义表情包（按用户隔离，每人上限 50 张）
    CREATE TABLE IF NOT EXISTS stickers (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      url        TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS todos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      title        TEXT    NOT NULL,
      description  TEXT    NOT NULL DEFAULT '',
      due_date     TEXT,
      status       TEXT    NOT NULL DEFAULT 'pending',
      exp_reward   INTEGER NOT NULL DEFAULT 10,
      area_id      INTEGER,
      created_at   TEXT    NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)  ON DELETE CASCADE,
      FOREIGN KEY (area_id) REFERENCES areas(id)  ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS achievements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL,
      icon        TEXT    NOT NULL DEFAULT '🏅',
      metric      TEXT    NOT NULL,
      threshold   INTEGER NOT NULL
    );
  `);

  // 迁移：老库补 hidden 列（世界频道使用隐藏区域承载）
  const areaCols = db.prepare('PRAGMA table_info(areas)').all().map((c) => c.name);
  if (!areaCols.includes('hidden')) {
    db.exec('ALTER TABLE areas ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;');
  }

  // 迁移：messages 补 post_id 列（活动帖专属讨论区消息；NULL 表示区域频道普通消息）
  const msgCols = db.prepare('PRAGMA table_info(messages)').all().map((c) => c.name);
  if (!msgCols.includes('post_id')) {
    db.exec('ALTER TABLE messages ADD COLUMN post_id INTEGER;');
  }
  // 迁移：messages 补 type 列（text | sticker | system | recalled）
  if (!msgCols.includes('type')) {
    db.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text';");
  }
  // 迁移：messages 补互动字段（回复/提及/撤回）
  if (!msgCols.includes('reply_to')) db.exec('ALTER TABLE messages ADD COLUMN reply_to TEXT;');
  if (!msgCols.includes('mentions')) db.exec('ALTER TABLE messages ADD COLUMN mentions TEXT;');
  if (!msgCols.includes('recalled_at')) db.exec('ALTER TABLE messages ADD COLUMN recalled_at TEXT;');
  if (!msgCols.includes('recalled_by')) db.exec('ALTER TABLE messages ADD COLUMN recalled_by INTEGER;');

  // 迁移：posts 补 status 列（活动状态机）
  const postCols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!postCols.includes('status')) {
    db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'open';");
  }
}
