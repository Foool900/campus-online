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
  // 一次性迁移：删除旧版「二手集市」表（market_listings / 旧 market_orders 含 listing_id 列），
  // 校园夜市 schema 全新重建（原型阶段旧市场无历史数据需保留）。
  const oldListings = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='market_listings'").get();
  if (oldListings) db.exec('DROP TABLE market_listings;');
  const oldOrders = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='market_orders'").get();
  if (oldOrders) {
    const _orderCols = db.prepare('PRAGMA table_info(market_orders)').all().map((c) => c.name);
    if (_orderCols.includes('listing_id')) db.exec('DROP TABLE market_orders;');
  }
  // 若 market_items 是旧 schema（无 cost_coin 列 / 含旧 CHECK），重建市场商品表族（空数据，直接 drop）
  const _items = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='market_items'").get();
  if (_items) {
    const _cols = db.prepare('PRAGMA table_info(market_items)').all().map((c) => c.name);
    if (!_cols.includes('cost_coin')) {
      db.exec('PRAGMA foreign_keys = OFF;');
      db.exec('DROP TABLE IF EXISTS market_disputes;');
      db.exec('DROP TABLE IF EXISTS market_blindbox_opens;');
      db.exec('DROP TABLE IF EXISTS market_blindbox_configs;');
      db.exec('DROP TABLE IF EXISTS market_bargains;');
      db.exec('DROP TABLE IF EXISTS market_orders;');
      db.exec('DROP TABLE IF EXISTS market_items;');
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname      TEXT    NOT NULL,
      college       TEXT    NOT NULL DEFAULT '',
      avatar        TEXT    NOT NULL DEFAULT '🎓',
      exp           INTEGER NOT NULL DEFAULT 0, -- 累计经验，只增不减，决定等级
      coin          INTEGER NOT NULL DEFAULT 0, -- 金币，可消费/托管
      frozen_coin   INTEGER NOT NULL DEFAULT 0, -- 冻结金币，托管中
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

    -- 经验发放流水（append-only；经验只发不扣，幂等键唯一防重复发放）
    -- 说明：from/to/task 均为软引用（不加外键），避免用户/任务删除时级联抹掉历史流水。
    CREATE TABLE IF NOT EXISTS exp_transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id    INTEGER,
      to_user_id      INTEGER,
      amount          INTEGER NOT NULL,
      task_id         INTEGER,
      type            TEXT    NOT NULL, -- grant（经验只发不扣）
      source          TEXT,             -- behavior | story | admin ...
      idempotency_key TEXT    NOT NULL UNIQUE,
      created_at      TEXT    NOT NULL
    );

    -- 金币流转流水（append-only 审计账本；幂等键唯一防重复划转）
    -- type：mint 造币 | freeze 托管 | transfer 转移 | refund 退回 | sink 回收
    CREATE TABLE IF NOT EXISTS coin_transactions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id    INTEGER,
      to_user_id      INTEGER,
      amount          INTEGER NOT NULL,
      type            TEXT    NOT NULL,
      related_type    TEXT,             -- task | market | signin | story | admin ...
      related_id      INTEGER,
      note            TEXT,
      idempotency_key TEXT    NOT NULL UNIQUE,
      created_at      TEXT    NOT NULL
    );

    -- 每日签到记录
    CREATE TABLE IF NOT EXISTS sign_ins (
      user_id      INTEGER NOT NULL,
      date         TEXT    NOT NULL, -- 'YYYY-MM-DD'（服务器本地日）
      streak       INTEGER NOT NULL DEFAULT 1,
      reward_coin  INTEGER NOT NULL DEFAULT 0,
      created_at   TEXT    NOT NULL,
      PRIMARY KEY (user_id, date),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    -- 触发式成就解锁记录（幂等：同用户同成就只一条）
    CREATE TABLE IF NOT EXISTS user_achievements (
      user_id          INTEGER NOT NULL,
      achievement_code TEXT    NOT NULL,
      unlocked_at      TEXT    NOT NULL,
      PRIMARY KEY (user_id, achievement_code),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
      reward_coin     INTEGER NOT NULL DEFAULT 0,  -- private 恒 0
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

    -- ===== 校园夜市 =====
    -- 期次（开市周期）
    CREATE TABLE IF NOT EXISTS market_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      status          TEXT    NOT NULL DEFAULT 'upcoming', -- upcoming | open | closed | settled
      draw_status     TEXT    NOT NULL DEFAULT 'pending',  -- pending | drawing | done
      signup_start_at TEXT    NOT NULL,
      signup_end_at   TEXT    NOT NULL,
      open_at         TEXT    NOT NULL,
      close_at        TEXT    NOT NULL,
      settle_at       TEXT,
      settle_key      TEXT    UNIQUE,
      seed_hash       TEXT,
      seed            TEXT,
      stall_count     INTEGER NOT NULL DEFAULT 30,
      roaming_minutes INTEGER NOT NULL DEFAULT 30,
      config_json     TEXT,
      created_at      TEXT    NOT NULL
    );

    -- 流动地摊
    CREATE TABLE IF NOT EXISTS market_stalls (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id          INTEGER NOT NULL,
      stall_no            INTEGER NOT NULL,
      owner_id            INTEGER,
      status              TEXT    NOT NULL DEFAULT 'available', -- available | reserved | occupied | released | expired
      deposit_coin        INTEGER NOT NULL DEFAULT 0,
      idempotency_key     TEXT    UNIQUE,
      reserved_expires_at TEXT,
      grabbed_at          TEXT,
      expires_at          TEXT,
      created_at          TEXT    NOT NULL,
      FOREIGN KEY (session_id) REFERENCES market_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id)    REFERENCES users(id)           ON DELETE SET NULL,
      UNIQUE (session_id, stall_no)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_stalls_owner ON market_stalls(session_id, owner_id) WHERE owner_id IS NOT NULL;

    -- 流动地摊报名 + 抽签
    CREATE TABLE IF NOT EXISTS market_stall_signups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      user_id    INTEGER NOT NULL,
      nonce      TEXT    NOT NULL,
      score      TEXT,
      result     TEXT    NOT NULL DEFAULT 'pending', -- pending | won | lost
      stall_id   INTEGER,
      created_at TEXT    NOT NULL,
      FOREIGN KEY (session_id) REFERENCES market_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)           ON DELETE CASCADE,
      UNIQUE (session_id, user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_signups_stall ON market_stall_signups(stall_id) WHERE stall_id IS NOT NULL;

    -- 固定店铺（静态 5 行身份）
    CREATE TABLE IF NOT EXISTS market_shops (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_no     INTEGER NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL
    );

    -- 固定店铺租期（每周）
    CREATE TABLE IF NOT EXISTS market_shop_terms (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id    INTEGER NOT NULL,
      term_week  TEXT    NOT NULL,
      owner_id   INTEGER,
      rent_coin  INTEGER NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'active', -- active | settled
      settled_at TEXT,
      created_at TEXT    NOT NULL,
      FOREIGN KEY (shop_id)  REFERENCES market_shops(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id)      ON DELETE SET NULL,
      UNIQUE (shop_id, term_week)
    );

    -- 固定店铺竞拍出价
    CREATE TABLE IF NOT EXISTS market_shop_bids (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id           INTEGER NOT NULL,
      term_week         TEXT    NOT NULL,
      user_id           INTEGER NOT NULL,
      amount_coin       INTEGER NOT NULL,
      frozen_total_coin INTEGER NOT NULL DEFAULT 0,
      frozen_key        TEXT,
      idempotency_key   TEXT    UNIQUE,
      deadline_at       TEXT,
      status            TEXT    NOT NULL DEFAULT 'active', -- active | won | refunded | outbid | cancelled
      created_at        TEXT    NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES market_shops(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)      ON DELETE CASCADE,
      UNIQUE (shop_id, term_week, user_id)
    );

    -- 商品
    CREATE TABLE IF NOT EXISTS market_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        INTEGER NOT NULL,
      stall_id          INTEGER,
      shop_id           INTEGER,
      seller_id         INTEGER NOT NULL,
      type              TEXT    NOT NULL DEFAULT 'normal', -- normal | blindbox | flash_sale
      title             TEXT    NOT NULL,
      description       TEXT    NOT NULL DEFAULT '',
      price_coin        INTEGER NOT NULL,
      cost_coin         INTEGER,
      stock             INTEGER NOT NULL DEFAULT 1,
      sold_count        INTEGER NOT NULL DEFAULT 0,
      status            TEXT    NOT NULL DEFAULT 'draft', -- draft | active | reserved | sold | expired | removed
      reserved_order_id INTEGER,
      is_official       INTEGER NOT NULL DEFAULT 0,
      flash_sale_at     TEXT,
      flash_sale_limit  INTEGER,
      idempotency_key   TEXT    UNIQUE,
      created_at        TEXT    NOT NULL,
      sold_at           TEXT,
      removed_at        TEXT,
      FOREIGN KEY (session_id) REFERENCES market_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (stall_id)   REFERENCES market_stalls(id)   ON DELETE SET NULL,
      FOREIGN KEY (shop_id)    REFERENCES market_shops(id)    ON DELETE SET NULL,
      FOREIGN KEY (seller_id)  REFERENCES users(id)           ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_items_session ON market_items(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_items_seller  ON market_items(seller_id);
    CREATE INDEX IF NOT EXISTS idx_items_flash   ON market_items(type, flash_sale_at, status);

    -- 订单
    CREATE TABLE IF NOT EXISTS market_orders (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id         INTEGER NOT NULL,
      buyer_id        INTEGER NOT NULL,
      seller_id       INTEGER NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'normal', -- normal | blindbox | flash_sale | official_flash_sale | bargain
      bargain_id      INTEGER,
      price_coin      INTEGER NOT NULL,
      fee_coin        INTEGER NOT NULL DEFAULT 0,
      status          TEXT    NOT NULL DEFAULT 'pending_payment', -- pending_payment | paid_escrow | delivered | completed | refunded | disputed | cancelled
      pay_deadline_at TEXT,
      paid_at         TEXT,
      delivered_at    TEXT,
      completed_at    TEXT,
      cancelled_at    TEXT,
      idempotency_key TEXT    UNIQUE,
      created_at      TEXT    NOT NULL,
      FOREIGN KEY (item_id)  REFERENCES market_items(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id)        ON DELETE CASCADE,
      FOREIGN KEY (seller_id) REFERENCES users(id)       ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_orders_buyer  ON market_orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_orders_seller ON market_orders(seller_id);
    CREATE INDEX IF NOT EXISTS idx_orders_item   ON market_orders(item_id);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_flash_one ON market_orders(item_id, buyer_id)
      WHERE type IN ('flash_sale','official_flash_sale') AND status NOT IN ('cancelled','refunded');

    -- 盲盒配置（内容快照 + 保证金）
    CREATE TABLE IF NOT EXISTS market_blindbox_configs (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id            INTEGER NOT NULL UNIQUE,
      content_json       TEXT    NOT NULL,
      deposit_coin       INTEGER NOT NULL,
      min_value_coin     INTEGER NOT NULL,
      deposit_frozen_key TEXT,
      penalty_coin       INTEGER NOT NULL DEFAULT 0,
      status             TEXT    NOT NULL DEFAULT 'active', -- active | held | released | forfeited
      hold_until         TEXT,
      released_at        TEXT,
      created_at         TEXT    NOT NULL,
      FOREIGN KEY (item_id) REFERENCES market_items(id) ON DELETE CASCADE
    );

    -- 盲盒开盒记录
    CREATE TABLE IF NOT EXISTS market_blindbox_opens (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id           INTEGER NOT NULL UNIQUE,
      item_id            INTEGER NOT NULL,
      buyer_id           INTEGER NOT NULL,
      opened_result_json TEXT    NOT NULL,
      opened_value_coin  INTEGER NOT NULL,
      status             TEXT    NOT NULL DEFAULT 'opened', -- opened | disputed
      opened_at          TEXT    NOT NULL,
      created_at         TEXT    NOT NULL,
      FOREIGN KEY (order_id) REFERENCES market_orders(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id)  REFERENCES market_items(id)  ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id)         ON DELETE CASCADE
    );

    -- 砍价
    CREATE TABLE IF NOT EXISTS market_bargains (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id         INTEGER NOT NULL,
      buyer_id        INTEGER NOT NULL,
      seller_id       INTEGER NOT NULL,
      attempt_no      INTEGER NOT NULL DEFAULT 1,
      offer_coin      INTEGER NOT NULL,
      frozen_key      TEXT,
      idempotency_key TEXT    UNIQUE,
      status          TEXT    NOT NULL DEFAULT 'pending', -- pending | accepted | rejected | expired | paid | refunded
      accepted_at     TEXT,
      expires_at      TEXT,
      created_at      TEXT    NOT NULL,
      FOREIGN KEY (item_id)  REFERENCES market_items(id) ON DELETE CASCADE,
      FOREIGN KEY (buyer_id) REFERENCES users(id)        ON DELETE CASCADE,
      FOREIGN KEY (seller_id) REFERENCES users(id)       ON DELETE CASCADE,
      UNIQUE (item_id, buyer_id, attempt_no)
    );
    CREATE INDEX IF NOT EXISTS idx_bargains_item  ON market_bargains(item_id);
    CREATE INDEX IF NOT EXISTS idx_bargains_buyer ON market_bargains(buyer_id);

    -- 信誉分聚合
    CREATE TABLE IF NOT EXISTS market_reputations (
      user_id           INTEGER PRIMARY KEY,
      score             INTEGER NOT NULL DEFAULT 70,
      level             TEXT    NOT NULL DEFAULT 'new', -- new | regular | trusted | veteran
      order_count       INTEGER NOT NULL DEFAULT 0,
      good_rate         REAL    NOT NULL DEFAULT 1,
      completion_rate   REAL    NOT NULL DEFAULT 1,
      cancel_rate       REAL    NOT NULL DEFAULT 0,
      dispute_lost_rate REAL    NOT NULL DEFAULT 0,
      protected_orders  INTEGER NOT NULL DEFAULT 0,
      updated_at        TEXT    NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 信誉事件（append-only）
    CREATE TABLE IF NOT EXISTS market_reputation_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      order_id   INTEGER NOT NULL,
      event      TEXT    NOT NULL, -- rating | completion | cancel | dispute_lost
      rating     INTEGER,
      created_at TEXT    NOT NULL,
      FOREIGN KEY (user_id)  REFERENCES users(id)        ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES market_orders(id) ON DELETE CASCADE,
      UNIQUE (order_id, event, user_id)
    );

    -- 全服喇叭
    CREATE TABLE IF NOT EXISTS market_broadcasts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER NOT NULL,
      user_id         INTEGER NOT NULL,
      seq             INTEGER NOT NULL,
      stall_id        INTEGER,
      content         TEXT    NOT NULL,
      fee_coin        INTEGER NOT NULL DEFAULT 0,
      status          TEXT    NOT NULL DEFAULT 'published', -- published | removed
      idempotency_key TEXT    UNIQUE,
      created_at      TEXT    NOT NULL,
      FOREIGN KEY (session_id) REFERENCES market_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id)    REFERENCES users(id)           ON DELETE CASCADE,
      UNIQUE (session_id, user_id, seq)
    );

    -- 纠纷 / 举报
    CREATE TABLE IF NOT EXISTS market_disputes (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id          INTEGER,
      item_id           INTEGER,
      reporter_id       INTEGER NOT NULL,
      report_key        TEXT    UNIQUE,
      type              TEXT    NOT NULL, -- blindbox_mismatch | fraud | report
      reason            TEXT    NOT NULL,
      evidence_json     TEXT,
      status            TEXT    NOT NULL DEFAULT 'pending', -- pending | reviewing | resolved_buyer | resolved_seller | dismissed
      resolved_by       INTEGER,
      resolved_at       TEXT,
      compensation_coin INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT    NOT NULL,
      FOREIGN KEY (order_id)    REFERENCES market_orders(id) ON DELETE SET NULL,
      FOREIGN KEY (item_id)     REFERENCES market_items(id)  ON DELETE SET NULL,
      FOREIGN KEY (reporter_id) REFERENCES users(id)         ON DELETE CASCADE
    );

    -- 举报计数（按月，YYYY-MM UTC；UNIQUE(user_id, month_key)）
    CREATE TABLE IF NOT EXISTS report_counters (
      user_id   INTEGER NOT NULL,
      month_key TEXT    NOT NULL,
      count     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, month_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- 运行时配置（押金/喇叭费/秒杀预算/举报月限/手续费率）
    CREATE TABLE IF NOT EXISTS market_configs (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 统一业务流水（biz 级；coin_tx_id 关联 coin_transactions，纯 treasury/sink 行为 NULL）
    CREATE TABLE IF NOT EXISTS market_ledger (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id      INTEGER,
      biz_type        TEXT    NOT NULL,
      biz_id          INTEGER,
      op              TEXT    NOT NULL, -- freeze | unfreeze | charge | refund | compensate | treasury_in | treasury_out | sink
      user_id         INTEGER,
      counterparty_id INTEGER,
      amount          INTEGER NOT NULL,
      coin_tx_id      INTEGER,
      idempotency_key TEXT    UNIQUE,
      created_at      TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_biz  ON market_ledger(biz_type, biz_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON market_ledger(user_id);

    -- 抽奖记录（Step 4 起：仅记录，非完整审计；draw_id 用作幂等键）
    CREATE TABLE IF NOT EXISTS lottery_draws (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      prize_coin INTEGER NOT NULL,
      created_at TEXT    NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

  // 迁移：users 经验账户 → 金币账户（coin/frozen_coin），并删除旧的 available_exp/frozen_exp
  if (!userCols.includes('coin')) db.exec('ALTER TABLE users ADD COLUMN coin INTEGER NOT NULL DEFAULT 0;');
  if (!userCols.includes('frozen_coin')) db.exec('ALTER TABLE users ADD COLUMN frozen_coin INTEGER NOT NULL DEFAULT 0;');
  if (userCols.includes('available_exp')) {
    // 回填：旧可支配经验 → 金币，旧冻结经验 → 冻结金币
    db.exec('UPDATE users SET coin = available_exp, frozen_coin = frozen_exp;');
    db.exec('ALTER TABLE users DROP COLUMN available_exp;');
  }
  if (userCols.includes('frozen_exp')) db.exec('ALTER TABLE users DROP COLUMN frozen_exp;');

  // 迁移：users 补 permissions（JSON 数组字符串）
  if (!userCols.includes('permissions')) {
    db.exec("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '[]';");
  }

  // 迁移：achievements 补 type / hint 列
  const achCols = db.prepare('PRAGMA table_info(achievements)').all().map((c) => c.name);
  if (!achCols.includes('type')) {
    db.exec("ALTER TABLE achievements ADD COLUMN type TEXT NOT NULL DEFAULT 'exploration';");
  }
  if (!achCols.includes('hint')) {
    db.exec("ALTER TABLE achievements ADD COLUMN hint TEXT NOT NULL DEFAULT '';");
  }

  // 迁移：exp_transactions 补 source（经验来源标记）
  const expTxCols = db.prepare('PRAGMA table_info(exp_transactions)').all().map((c) => c.name);
  if (!expTxCols.includes('source')) db.exec('ALTER TABLE exp_transactions ADD COLUMN source TEXT;');

  // 迁移：tasks 奖励字段 reward_exp → reward_coin（金币）
  const taskCols = db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name);
  if (!taskCols.includes('reward_coin')) {
    db.exec('ALTER TABLE tasks ADD COLUMN reward_coin INTEGER NOT NULL DEFAULT 0;');
    db.exec('UPDATE tasks SET reward_coin = reward_exp;');
  }
  if (taskCols.includes('reward_exp')) db.exec('ALTER TABLE tasks DROP COLUMN reward_exp;');

  // 迁移：删除旧的经验分类资产树 + 旧待办（已被金币账户 / tasks 私密任务取代）
  db.exec('DROP TABLE IF EXISTS exp_admin_logs;');
  db.exec('DROP TABLE IF EXISTS user_exp;');
  db.exec('DROP TABLE IF EXISTS exp_categories;');
  db.exec('DROP TABLE IF EXISTS todos;');

}
