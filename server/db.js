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
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL,
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
      created_at TEXT    NOT NULL,
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE
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
}
