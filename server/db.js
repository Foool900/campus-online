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
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname      TEXT    NOT NULL,
      college       TEXT    NOT NULL DEFAULT '',
      avatar        TEXT    NOT NULL DEFAULT '🎓',
      exp           INTEGER NOT NULL DEFAULT 0, -- 累计经验 totalExp，只增不减，决定等级
      available_exp INTEGER NOT NULL DEFAULT 0, -- 可用经验，可托管/可支配
      frozen_exp    INTEGER NOT NULL DEFAULT 0, -- 冻结经验，托管中
      password_hash TEXT,
      role          TEXT    NOT NULL DEFAULT 'member',
      created_at    TEXT    NOT NULL
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
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id        INTEGER NOT NULL,
      user_id           INTEGER NOT NULL,
      post_id           INTEGER,
      conversation_type TEXT,
      conversation_id   INTEGER,
      type              TEXT    NOT NULL DEFAULT 'text',
      content           TEXT    NOT NULL,
      reply_to          TEXT,
      mentions          TEXT,
      recalled_at       TEXT,
      recalled_by       INTEGER,
      created_at        TEXT    NOT NULL,
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

    -- 经验流转流水（append-only 审计账本；幂等键唯一防重复划转）
    -- 说明：from/to/task 均为软引用（不加外键），避免用户/任务删除时级联抹掉历史流水。
    CREATE TABLE IF NOT EXISTS exp_transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id    INTEGER,
      to_user_id      INTEGER,
      amount          INTEGER NOT NULL,
      task_id         INTEGER,
      type            TEXT    NOT NULL, -- freeze | transfer | refund | grant
      idempotency_key TEXT    NOT NULL UNIQUE,
      created_at      TEXT    NOT NULL
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

    -- 登录会话（token 凭证）
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL,
      created_at TEXT    NOT NULL,
      expires_at TEXT    NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 学员身份认证申请（人工审核）
    CREATE TABLE IF NOT EXISTS verifications (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      images       TEXT    NOT NULL DEFAULT '[]',
      status       TEXT    NOT NULL DEFAULT 'pending',
      submitted_at TEXT    NOT NULL,
      reviewed_by  INTEGER,
      reviewed_at  TEXT,
      note         TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 任务系统（private 私密备忘 / public 公开任务）
    -- 状态机：
    --   private: todo → done（可撤销）
    --   public:  published → accepted → submitted → approved / terminated
    --             accepted 接取者放弃 → published；submitted 驳回 → accepted（reject_count 达上限 → terminated）
    --             published/accepted/submitted 到期 → expired；非终态可被发布者取消 → cancelled
    CREATE TABLE IF NOT EXISTS tasks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      publisher_id    INTEGER NOT NULL,
      assignee_id     INTEGER,
      type            TEXT    NOT NULL,            -- 'private' | 'public'
      title           TEXT    NOT NULL,
      description     TEXT    NOT NULL DEFAULT '',
      tags            TEXT    NOT NULL DEFAULT '[]', -- JSON 字符串数组
      reward_exp      INTEGER NOT NULL DEFAULT 0,  -- private 恒 0
      status          TEXT    NOT NULL,
      min_complete_at TEXT,
      deadline_at     TEXT,
      submitted_proof TEXT,                        -- JSON：{ text, imageUrl, link }
      reject_count    INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT    NOT NULL,
      accepted_at     TEXT,
      submitted_at    TEXT,
      finished_at     TEXT,
      FOREIGN KEY (publisher_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_id)   REFERENCES users(id) ON DELETE SET NULL
    );

    -- 审计日志（异常行为打标，第一版只记录不封禁）
    CREATE TABLE IF NOT EXISTS audit_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER,
      event      TEXT    NOT NULL,
      detail     TEXT,
      ip         TEXT,
      user_agent TEXT,
      created_at TEXT    NOT NULL
    );

    -- 好友关系（含好友申请；方向性 user_id → friend_id）
    CREATE TABLE IF NOT EXISTS friendships (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      friend_id  INTEGER NOT NULL,
      status     TEXT    NOT NULL DEFAULT 'pending', -- pending | accepted | blocked
      message    TEXT    NOT NULL DEFAULT '',
      created_at TEXT    NOT NULL,
      updated_at TEXT    NOT NULL,
      UNIQUE(user_id, friend_id)
    );

    -- 会话（direct 私信 / group 群聊）
    CREATE TABLE IF NOT EXISTS conversations (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      type            TEXT    NOT NULL, -- 'direct' | 'group'
      created_at      TEXT    NOT NULL,
      last_message_at TEXT
    );

    -- 会话成员
    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      role            TEXT    NOT NULL DEFAULT 'member', -- 'owner' | 'member'
      joined_at       TEXT    NOT NULL,
      last_read_at    TEXT,
      PRIMARY KEY (conversation_id, user_id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)         REFERENCES users(id)         ON DELETE CASCADE
    );

    -- 群聊信息
    CREATE TABLE IF NOT EXISTS groups (
      conversation_id INTEGER PRIMARY KEY,
      name            TEXT    NOT NULL,
      owner_id        INTEGER NOT NULL,
      created_at      TEXT    NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id)         REFERENCES users(id)         ON DELETE CASCADE
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

  // 迁移：messages 补会话维度列（conversation_type: activity/chat, conversation_id）
  if (!msgCols.includes('conversation_type')) db.exec('ALTER TABLE messages ADD COLUMN conversation_type TEXT;');
  if (!msgCols.includes('conversation_id')) db.exec('ALTER TABLE messages ADD COLUMN conversation_id INTEGER;');
  // 回填（幂等，每次启动兜底；只填 NULL 行，不覆盖已有值）：activity → post_id；chat → channel_id
  db.exec(`
    UPDATE messages SET conversation_type = 'activity', conversation_id = post_id WHERE post_id IS NOT NULL AND conversation_type IS NULL;
    UPDATE messages SET conversation_type = 'chat',     conversation_id = channel_id WHERE post_id IS NULL AND conversation_type IS NULL;
  `);

  // 迁移：posts 补 status 列（活动状态机）
  const postCols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (!postCols.includes('status')) {
    db.exec("ALTER TABLE posts ADD COLUMN status TEXT NOT NULL DEFAULT 'open';");
  }

  // 迁移：users 补 password_hash / role（登录 + 角色）
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT;');
  if (!userCols.includes('role')) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member';");

  // 迁移：users 补经验账户字段（exp 保留为累计 totalExp；available_exp 可支配 / frozen_exp 冻结）
  if (!userCols.includes('available_exp')) {
    db.exec('ALTER TABLE users ADD COLUMN available_exp INTEGER NOT NULL DEFAULT 0;');
    db.exec('ALTER TABLE users ADD COLUMN frozen_exp INTEGER NOT NULL DEFAULT 0;');
    // 历史用户回填：已有累计经验全部视为可用余额（最安全，不坑老玩家），冻结从 0 开始
    db.exec('UPDATE users SET available_exp = exp;');
  } else if (!userCols.includes('frozen_exp')) {
    db.exec('ALTER TABLE users ADD COLUMN frozen_exp INTEGER NOT NULL DEFAULT 0;');
  }
}
