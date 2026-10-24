import { Router } from 'express';
import { createHmac, randomBytes, createHash } from 'node:crypto';
import { db, nowIso } from '../db.js';
import { requireRole } from '../auth.js';
import { config } from '../config.js';
import { applyCoinRaw } from '../coin.js';
import { systemAccountId } from '../treasury.js';
import { containsSensitiveWord } from '../utils/sensitive-words.js';

const router = Router();

// ============================================================
// 基础工具
// ============================================================

function getSession(id) {
  return db.prepare('SELECT * FROM market_sessions WHERE id = ?').get(id);
}

function currentSession() {
  return db.prepare('SELECT * FROM market_sessions ORDER BY open_at DESC, id DESC LIMIT 1').get();
}

function isOpen(session) {
  return !!session && session.status === 'open';
}

function assertOpen(session) {
  if (!isOpen(session)) {
    const e = new Error('市场未开市');
    e.code = 'MARKET_CLOSED';
    e.status = 409;
    throw e;
  }
}

// 运行时配置：market_configs 优先，回退 config.market
function cfg(key) {
  const row = db.prepare('SELECT value FROM market_configs WHERE key = ?').get(key);
  if (row) {
    try { return JSON.parse(row.value); } catch { /* ignore */ }
  }
  return config.market[key];
}

// 当前奖池余额 = SYSTEM 账户 coin（真实账户，不是旧 treasury 表）
function getSystemBalance() {
  return db.prepare('SELECT coin FROM users WHERE id = ?').get(systemAccountId())?.coin ?? 0;
}

function writeLedger({ sessionId = null, bizType, bizId = null, op, userId = null, counterpartyId = null, amount, coinTxId = null, idempotencyKey }) {
  db.prepare('INSERT INTO market_ledger (session_id, biz_type, biz_id, op, user_id, counterparty_id, amount, coin_tx_id, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sessionId, bizType, bizId, op, userId, counterpartyId, amount, coinTxId, idempotencyKey, nowIso());
}

function throwBiz(code, message, status = 400) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  throw e;
}

function assertNotSystem(userId) {
  const u = db.prepare('SELECT role FROM users WHERE id=?').get(userId);
  if (u && u.role === 'system') return { error: '系统账号不可操作市场', status: 403 };
  return null;
}

function runTx(fn) {
  try {
    return { value: db.transaction(fn)() };
  } catch (e) {
    if (e && e.code) return { error: e.message, code: e.code, status: e.status || 400 };
    throw e;
  }
}

// ============================================================
// 期次（session）
// ============================================================

// 以 openAt（ISO）为准创建期次，报名/闭市时间由 config 推导
export function createSession(openAtIso) {
  const openAt = new Date(openAtIso);
  if (Number.isNaN(openAt.getTime())) return { error: '开市时间格式无效', status: 400 };
  const signupStart = new Date(openAt.getTime() - cfg('signupBeforeMin') * 60000);
  const signupEnd = new Date(openAt.getTime() - cfg('signupCloseBeforeMin') * 60000);
  const closeAt = new Date(openAt.getTime() + cfg('durationMin') * 60000);
  const seed = randomBytes(32).toString('hex');

  const info = db.prepare('INSERT INTO market_sessions (status, signup_start_at, signup_end_at, open_at, close_at, seed_hash, seed, stall_count, roaming_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('upcoming', signupStart.toISOString(), signupEnd.toISOString(), openAt.toISOString(), closeAt.toISOString(),
      createHash('sha256').update(seed).digest('hex'), seed, cfg('stallCount'), cfg('roamingMinutes'), nowIso());
  const sessionId = Number(info.lastInsertRowid);

  // 预建流动地摊
  const insertStall = db.prepare('INSERT INTO market_stalls (session_id, stall_no, deposit_coin, created_at) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (let i = 1; i <= cfg('stallCount'); i++) {
      insertStall.run(sessionId, i, cfg('depositCoin'), nowIso());
    }
  })();

  return { session: getSession(sessionId) };
}

// 确保 5 家固定店铺存在（幂等）
export function ensureMarketShops() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM market_shops').get().c;
  if (count >= cfg('shopCount')) return;
  const names = ['学苑老字号', '跳蚤中心', '数码驿站', '文创小铺', '生活杂货'];
  const ins = db.prepare('INSERT OR IGNORE INTO market_shops (shop_no, name, description, sort_order, created_at) VALUES (?, ?, ?, ?, ?)');
  for (let i = 1; i <= cfg('shopCount'); i++) {
    ins.run(i, names[i - 1] || `店铺${i}`, '', i - 1, nowIso());
  }
}

// ============================================================
// 流动地摊：报名抽签
// ============================================================

export function signupStall(userId, sessionId) {
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  const now = Date.now();
  const start = new Date(session.signup_start_at).getTime();
  const end = new Date(session.signup_end_at).getTime();
  if (now < start || now >= end) return { error: '当前不在报名时段', status: 409 };

  const nonce = randomBytes(16).toString('hex');
  try {
    db.prepare('INSERT INTO market_stall_signups (session_id, user_id, nonce, created_at) VALUES (?, ?, ?, ?)').run(sessionId, userId, nonce, nowIso());
    return { ok: true, signedUp: true };
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return { ok: true, signedUp: false, already: true };
    throw e;
  }
}

// 抽签：commit-reveal + HMAC，整体幂等
export function drawStalls(sessionId) {
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  if (session.draw_status === 'done') return { ok: true, drawn: false };

  // 条件更新拿抽签权；已 drawing（上次崩溃）则重入
  db.prepare("UPDATE market_sessions SET draw_status='drawing' WHERE id=? AND draw_status='pending'").run(sessionId);

  const seed = session.seed || randomBytes(32).toString('hex');
  if (!session.seed) {
    db.prepare('UPDATE market_sessions SET seed=?, seed_hash=? WHERE id=?').run(seed, createHash('sha256').update(seed).digest('hex'), sessionId);
  }

  const signups = db.prepare("SELECT * FROM market_stall_signups WHERE session_id=? AND result='pending' ORDER BY id ASC").all(sessionId);
  const scored = signups
    .map((s) => ({ id: s.id, userId: s.user_id, score: createHmac('sha256', seed).update(`${sessionId}|${s.user_id}|${s.nonce}`).digest('hex') }))
    .sort((a, b) => (a.score < b.score ? -1 : a.score > b.score ? 1 : a.user_id - b.user_id));

  const stalls = db.prepare('SELECT id, stall_no FROM market_stalls WHERE session_id=? ORDER BY stall_no ASC').all(sessionId);
  const reservedExpires = new Date(Date.now() + 15 * 60000).toISOString(); // 中签确认截止 15min

  db.transaction(() => {
    const upd = db.prepare('UPDATE market_stall_signups SET score=?, result=?, stall_id=? WHERE id=?');
    const stallUpd = db.prepare("UPDATE market_stalls SET status='reserved', owner_id=?, reserved_expires_at=? WHERE id=? AND status='available'");
    scored.forEach((w, i) => {
      if (i < session.stall_count && stalls[i]) {
        upd.run(w.score, 'won', stalls[i].id, w.id);
        stallUpd.run(w.userId, reservedExpires, stalls[i].id);
      } else {
        upd.run(w.score, 'lost', null, w.id);
      }
    });
    db.prepare("UPDATE market_sessions SET draw_status='done' WHERE id=?").run(sessionId);
  })();

  return { ok: true, drawn: true, winners: Math.min(scored.length, session.stall_count) };
}

// 余位先到先得
export function grabStall(userId, sessionId) {
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  assertOpen(session);

  // 每期每人一摊（由 UNIQUE(session_id, owner_id) 兜底，这里先查）
  const owned = db.prepare("SELECT id FROM market_stalls WHERE session_id=? AND owner_id=? AND status IN ('reserved','occupied')").get(sessionId, userId);
  if (owned) return { error: '本期你已拥有摊位', status: 409 };

  const key = `stall:grab:${sessionId}:${userId}`;
  const stall = db.prepare("SELECT id FROM market_stalls WHERE session_id=? AND status='available' ORDER BY stall_no ASC LIMIT 1").get(sessionId);
  if (!stall) return { error: '摊位已被抢完', status: 409 };

  const reservedExpires = new Date(Date.now() + 15 * 60000).toISOString();
  const r = runTx(() => {
    const up = db.prepare("UPDATE market_stalls SET status='reserved', owner_id=?, reserved_expires_at=?, idempotency_key=? WHERE id=? AND status='available'").run(userId, reservedExpires, key, stall.id);
    if (up.changes === 0) throwBiz('STALL_TAKEN', '摊位已被抢走', 409);
    return { stallId: stall.id };
  });
  if (r.error) return r;
  return { ok: true, stallId: r.value.stallId };
}

// 确认占位（冻结押金）
export function confirmStall(userId, stallId) {
  const stall = db.prepare('SELECT * FROM market_stalls WHERE id=?').get(stallId);
  if (!stall) return { error: '摊位不存在', status: 404 };
  if (stall.owner_id !== userId) return { error: '不是你的摊位', status: 403 };
  if (stall.status !== 'reserved') return { error: '当前状态不可确认', status: 409 };

  const session = getSession(stall.session_id);
  assertOpen(session);
  if (stall.reserved_expires_at && nowIso() > stall.reserved_expires_at) {
    return { error: '确认已超时', status: 409 };
  }

  const expiresAt = new Date(Date.now() + cfg('roamingMinutes') * 60000).toISOString();
  const key = `stall:confirm:${stallId}`;
  const r = runTx(() => {
    const up = db.prepare("UPDATE market_stalls SET status='occupied', grabbed_at=?, expires_at=? WHERE id=? AND status='reserved'").run(nowIso(), expiresAt, stallId);
    if (up.changes === 0) throwBiz('STALL_BAD_STATE', '当前状态不可确认', 409);
    const coin = applyCoinRaw({ fromUserId: userId, amount: stall.deposit_coin, type: 'freeze', relatedType: 'market_stall_deposit', relatedId: stallId, idempotencyKey: key });
    if (coin.error) throwBiz(coin.code, coin.error, coin.status);
    writeLedger({ sessionId: stall.session_id, bizType: 'stall_deposit', bizId: stallId, op: 'freeze', userId, amount: stall.deposit_coin, coinTxId: coin.txId, idempotencyKey: `${key}:ledger` });
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// 释放摊位
export function releaseStall(userId, stallId) {
  const stall = db.prepare('SELECT * FROM market_stalls WHERE id=?').get(stallId);
  if (!stall) return { error: '摊位不存在', status: 404 };
  if (stall.owner_id !== userId) return { error: '不是你的摊位', status: 403 };
  if (!['reserved', 'occupied'].includes(stall.status)) return { error: '当前状态不可释放', status: 409 };

  const r = runTx(() => {
    db.prepare("UPDATE market_stalls SET status='released', expires_at=NULL, reserved_expires_at=NULL WHERE id=?").run(stallId);
    // 未售商品下架
    db.prepare("UPDATE market_items SET status='expired' WHERE stall_id=? AND status IN ('active','reserved')").run(stallId);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// ============================================================
// 商品
// ============================================================

export function createItem(userId, { sessionId, title, description, priceCoin, type = 'normal', stock = 1, contentJson = null, valueCoin = null }) {
  const sys = assertNotSystem(userId);
  if (sys) return sys;
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  const t = (title || '').toString().trim();
  const price = Number(priceCoin);
  if (!t) return { error: '标题不能为空', status: 400 };
  if (t.length > 60) return { error: '标题过长（最多 60 字）', status: 400 };
  if (!Number.isInteger(price) || price <= 0) return { error: '价格必须为正整数金币', status: 400 };
  if (!Number.isInteger(stock) || stock <= 0) return { error: '库存必须为正整数', status: 400 };
  if (!['normal', 'blindbox', 'flash_sale'].includes(type)) return { error: '商品类型无效', status: 400 };
  if (type === 'blindbox' && stock !== 1) return { error: '盲盒库存必须为 1', status: 400 };
  if (containsSensitiveWord(t) || containsSensitiveWord((description || '').toString())) {
    return { error: '内容包含违规词，请修改', code: 'SENSITIVE_CONTENT', status: 400 };
  }

  const key = `item:${sessionId}:${userId}:${randomBytes(8).toString('hex')}`;
  const r = runTx(() => {
    const info = db.prepare("INSERT INTO market_items (session_id, seller_id, type, title, description, price_coin, stock, status, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)")
      .run(sessionId, userId, type, t, (description || '').toString().trim(), price, stock, key, nowIso());
    const itemId = Number(info.lastInsertRowid);

    if (type === 'blindbox') {
      const content = contentJson || JSON.stringify({ surprise: true });
      const deposit = Math.max(1, Math.floor(price * cfg('blindboxDepositRatio')));
      const minValue = Math.max(1, Math.floor(price * cfg('blindboxMinValueRatio')));
      db.prepare('INSERT INTO market_blindbox_configs (item_id, content_json, deposit_coin, min_value_coin, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(itemId, content, deposit, minValue, nowIso());
    }
    return { itemId };
  });
  if (r.error) return r;
  return { itemId: r.value.itemId };
}

function mapItem(row) {
  if (!row) return row;
  return {
    id: row.id, sessionId: row.session_id, stallId: row.stall_id, shopId: row.shop_id, sellerId: row.seller_id,
    type: row.type, title: row.title, description: row.description, priceCoin: row.price_coin, stock: row.stock,
    soldCount: row.sold_count, status: row.status, isOfficial: !!row.is_official, flashSaleAt: row.flash_sale_at,
    createdAt: row.created_at, soldAt: row.sold_at,
    sellerName: row.seller_name, sellerAvatar: row.seller_avatar,
  };
}

function mapBargain(row) {
  if (!row) return row;
  return {
    id: row.id, itemId: row.item_id, itemTitle: row.item_title, itemPrice: row.item_price,
    buyerId: row.buyer_id, buyerName: row.buyer_name, buyerAvatar: row.buyer_avatar,
    offerCoin: row.offer_coin, attemptNo: row.attempt_no, status: row.status,
    createdAt: row.created_at, expiresAt: row.expires_at,
  };
}

// 上架（draft → active，绑定摊位）
export function listItem(userId, itemId, { stallId = null, shopId = null }) {
  const sys = assertNotSystem(userId);
  if (sys) return sys;
  const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(itemId);
  if (!item) return { error: '商品不存在', status: 404 };
  if (item.seller_id !== userId) return { error: '不是你的商品', status: 403 };
  if (item.status !== 'draft') return { error: '商品已上架', status: 409 };

  const session = getSession(item.session_id);
  assertOpen(session);

  if (stallId) {
    const stall = db.prepare('SELECT * FROM market_stalls WHERE id=?').get(stallId);
    if (!stall || stall.owner_id !== userId || stall.status !== 'occupied') return { error: '摊位无效', status: 400 };
  } else if (shopId) {
    const term = db.prepare("SELECT * FROM market_shop_terms WHERE shop_id=? AND owner_id=? AND status='active'").get(shopId, userId);
    if (!term) return { error: '店铺无效', status: 400 };
  } else {
    return { error: '需指定摊位或店铺', status: 400 };
  }

  const r = runTx(() => {
    const up = db.prepare("UPDATE market_items SET status='active', stall_id=?, shop_id=? WHERE id=? AND status='draft'").run(stallId, shopId, itemId);
    if (up.changes === 0) throwBiz('ITEM_BAD_STATE', '商品已上架', 409);

    // 盲盒：冻结保证金
    if (item.type === 'blindbox') {
      const bc = db.prepare('SELECT * FROM market_blindbox_configs WHERE item_id=?').get(itemId);
      const key = `blindbox_deposit:${itemId}`;
      const coin = applyCoinRaw({ fromUserId: userId, amount: bc.deposit_coin, type: 'freeze', relatedType: 'market_blindbox_deposit', relatedId: itemId, idempotencyKey: key });
      if (coin.error) throwBiz(coin.code, coin.error, coin.status);
      db.prepare('UPDATE market_blindbox_configs SET deposit_frozen_key=? WHERE item_id=?').run(key, itemId);
      writeLedger({ sessionId: item.session_id, bizType: 'blindbox_deposit', bizId: itemId, op: 'freeze', userId, amount: bc.deposit_coin, coinTxId: coin.txId, idempotencyKey: `${key}:ledger` });
    }
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

export function removeItem(userId, itemId) {
  const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(itemId);
  if (!item) return { error: '商品不存在', status: 404 };
  if (item.seller_id !== userId) return { error: '不是你的商品', status: 403 };
  if (!['active', 'draft'].includes(item.status)) return { error: '当前状态不可下架', status: 409 };

  const r = runTx(() => {
    const up = db.prepare("UPDATE market_items SET status='removed', removed_at=? WHERE id=? AND status IN ('active','draft')").run(nowIso(), itemId);
    if (up.changes === 0) throwBiz('ITEM_BAD_STATE', '下架失败', 409);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// ============================================================
// 购买 / 订单
// ============================================================

// 官方秒杀购买（模型 A）：买家付款真实进 SYSTEM（pay），补贴只作账面指标（budget_spend）
function buyOfficialFlashSale(buyerId, item) {
  const sysId = systemAccountId();
  const subsidy = (item.cost_coin ?? item.price_coin) - item.price_coin;
  const budget = cfg('flashSaleBudget');

  try {
    const r = db.transaction(() => {
      // 1. 扣库存
      const stockRes = db.prepare("UPDATE market_items SET sold_count = sold_count + 1 WHERE id=? AND status='active' AND sold_count < stock").run(item.id);
      if (stockRes.changes === 0) throwBiz('SOLD_OUT', '商品已售罄', 409);

      // 2-3. budget 校验（累计补贴，按 session 独立）
      const spent = db.prepare("SELECT COALESCE(SUM(amount),0) AS s FROM market_ledger WHERE biz_type='flash_sale_subsidy' AND session_id=?").get(item.session_id).s;
      if (spent + subsidy > budget) throwBiz('FLASH_SALE_BUDGET_EXCEEDED', '秒杀补贴预算已用完', 409);

      // 4. 建订单（先拿 order_id）
      const o = db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, price_coin, fee_coin, status, completed_at, idempotency_key, created_at) VALUES (?, ?, ?, 'official_flash_sale', ?, 0, 'completed', ?, ?, ?)")
        .run(item.id, buyerId, sysId, item.price_coin, nowIso(), `flash_sale_order:${buyerId}:${item.id}`, nowIso());
      const orderId = Number(o.lastInsertRowid);

      // 5. pay(buyer → SYSTEM, price)
      const payKey = `flash_sale_sale:${orderId}`;
      const pay = applyCoinRaw({ fromUserId: buyerId, toUserId: sysId, amount: item.price_coin, type: 'pay', relatedType: 'market', relatedId: orderId, idempotencyKey: payKey });
      if (pay.error) throwBiz(pay.code, pay.error, pay.status);

      // 6. ledger treasury_in（真实划转，挂 coin_tx_id）
      writeLedger({ sessionId: item.session_id, bizType: 'flash_sale_sale', bizId: orderId, op: 'treasury_in', userId: buyerId, counterpartyId: sysId, amount: item.price_coin, coinTxId: pay.txId, idempotencyKey: `${payKey}:ledger` });

      // 7. ledger budget_spend（账面补贴，无金币，coin_tx_id=NULL）
      writeLedger({ sessionId: item.session_id, bizType: 'flash_sale_subsidy', bizId: orderId, op: 'budget_spend', amount: subsidy, idempotencyKey: `${payKey}:budget` });

      // 8. 商品 sold_count>=stock → sold
      db.prepare("UPDATE market_items SET status='sold', sold_at=? WHERE id=? AND sold_count>=stock").run(nowIso(), item.id);

      return { orderId, price: item.price_coin, subsidy };
    })();
    return { ok: true, ...r, treasury: getSystemBalance() };
  } catch (e) {
    if (e && e.status) return { error: e.message, code: e.code, status: e.status };
    throw e;
  }
}

export function buyItem(buyerId, itemId) {
  const sys = assertNotSystem(buyerId);
  if (sys) return sys;
  const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(itemId);
  if (!item) return { error: '商品不存在', status: 404 };
  if (item.seller_id === buyerId) return { error: '不能购买自己的商品', status: 400 };
  const session = getSession(item.session_id);
  assertOpen(session);

  // 官方秒杀分支（模型 A）
  if (item.is_official && item.type === 'flash_sale') {
    return buyOfficialFlashSale(buyerId, item);
  }

  const feeRate = cfg('tradeFeeRate') ?? config.coin.tradeFeeRate;
  const fee = Math.floor(item.price_coin * feeRate);
  const key = `order:${itemId}:${buyerId}:buy`;

  const r = runTx(() => {
    // 锁定商品（单件）/ 扣库存（多件）
    let stockRes;
    if (item.stock === 1) {
      stockRes = db.prepare("UPDATE market_items SET status='reserved', reserved_order_id=NULL WHERE id=? AND status='active' AND sold_count < stock").run(itemId);
    } else {
      stockRes = db.prepare("UPDATE market_items SET sold_count = sold_count + 1 WHERE id=? AND status='active' AND sold_count < stock").run(itemId);
    }
    if (stockRes.changes === 0) throwBiz('OUT_OF_STOCK', '商品已售罄', 409);

    // 冻结付款
    const coin = applyCoinRaw({ fromUserId: buyerId, amount: item.price_coin, type: 'freeze', relatedType: 'market_order', relatedId: itemId, idempotencyKey: key });
    if (coin.error) throwBiz(coin.code, coin.error, coin.status);

    const info = db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, price_coin, fee_coin, status, paid_at, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, 'paid_escrow', ?, ?, ?)")
      .run(itemId, buyerId, item.seller_id, item.type, item.price_coin, fee, nowIso(), `${key}:order`, nowIso());
    const orderId = Number(info.lastInsertRowid);

    // 回填单件锁定的订单
    if (item.stock === 1) db.prepare('UPDATE market_items SET reserved_order_id=? WHERE id=?').run(orderId, itemId);

    writeLedger({ sessionId: item.session_id, bizType: 'order_pay', bizId: orderId, op: 'freeze', userId: buyerId, amount: item.price_coin, coinTxId: coin.txId, idempotencyKey: `${key}:ledger` });
    return { orderId, price: item.price_coin, fee };
  });
  if (r.error) return r;
  return { ok: true, ...r.value };
}

export function payOrder(buyerId, orderId) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', status: 404 };
  if (order.buyer_id !== buyerId) return { error: '不是你的订单', status: 403 };
  if (order.status !== 'pending_payment') return { error: '当前状态不可支付', status: 409 };
  if (order.pay_deadline_at && nowIso() > order.pay_deadline_at) return { error: '支付已超时', status: 409 };

  const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(order.item_id);
  const key = `order:${orderId}:pay`;
  const r = runTx(() => {
    const up = db.prepare("UPDATE market_orders SET status='paid_escrow', paid_at=? WHERE id=? AND status='pending_payment'").run(nowIso(), orderId);
    if (up.changes === 0) throwBiz('ORDER_BAD_STATE', '支付失败', 409);
    if (order.type === 'bargain') {
      // 砍价订单：出价已在发起时冻结，支付只做状态流转，不重复冻结
      db.prepare("UPDATE market_bargains SET status='paid' WHERE id=?").run(order.bargain_id);
    } else {
      const coin = applyCoinRaw({ fromUserId: buyerId, amount: order.price_coin, type: 'freeze', relatedType: 'market_order', relatedId: orderId, idempotencyKey: key });
      if (coin.error) throwBiz(coin.code, coin.error, coin.status);
      writeLedger({ sessionId: item?.session_id, bizType: 'order_pay', bizId: orderId, op: 'freeze', userId: buyerId, amount: order.price_coin, coinTxId: coin.txId, idempotencyKey: `${key}:ledger` });
    }
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

export function deliverOrder(sellerId, orderId) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', status: 404 };
  if (order.seller_id !== sellerId) return { error: '不是你的订单', status: 403 };
  if (order.status !== 'paid_escrow') return { error: '当前状态不可交付', status: 409 };
  const r = runTx(() => {
    const up = db.prepare("UPDATE market_orders SET status='delivered', delivered_at=? WHERE id=? AND status='paid_escrow'").run(nowIso(), orderId);
    if (up.changes === 0) throwBiz('ORDER_BAD_STATE', '交付失败', 409);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// 买家确认收货：托管 → 卖家净额 + 手续费 → 奖池
export function confirmOrder(buyerId, orderId) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', status: 404 };
  if (order.buyer_id !== buyerId) return { error: '不是你的订单', status: 403 };
  if (!['paid_escrow', 'delivered'].includes(order.status)) return { error: '当前状态不可确认', status: 409 };

  const itemSessionId = db.prepare('SELECT session_id FROM market_items WHERE id=?').get(order.item_id)?.session_id;
  const fee = order.fee_coin;
  const net = order.price_coin - fee;
  const key = `order:${orderId}:confirm`;
  const r = runTx(() => {
    const up = db.prepare("UPDATE market_orders SET status='completed', completed_at=? WHERE id=? AND status IN ('paid_escrow','delivered')").run(nowIso(), orderId);
    if (up.changes === 0) throwBiz('ORDER_BAD_STATE', '确认失败', 409);

    // 托管拆账：卖家净额（transfer）、手续费（refund 回买家再 sink 销毁 + treasury 入账）
    if (net > 0) {
      const t = applyCoinRaw({ fromUserId: buyerId, toUserId: order.seller_id, amount: net, type: 'transfer', relatedType: 'market_order', relatedId: orderId, idempotencyKey: `${key}:transfer` });
      if (t.error) throwBiz(t.code, t.error, t.status);
      writeLedger({ sessionId: itemSessionId, bizType: 'order_charge', bizId: orderId, op: 'charge', userId: order.seller_id, counterpartyId: buyerId, amount: net, coinTxId: t.txId, idempotencyKey: `${key}:ledger:charge` });
    }
    if (fee > 0) {
      const feeKey = `fee_treasury:${orderId}`;
      const t = applyCoinRaw({ fromUserId: buyerId, toUserId: systemAccountId(), amount: fee, type: 'transfer', relatedType: 'market_order', relatedId: orderId, idempotencyKey: feeKey });
      if (t.error) throwBiz(t.code, t.error, t.status);
      writeLedger({ sessionId: itemSessionId, bizType: 'fee_treasury', bizId: orderId, op: 'treasury_in', userId: buyerId, counterpartyId: systemAccountId(), amount: fee, coinTxId: t.txId, idempotencyKey: `${feeKey}:ledger` });
    }

    // 商品：单件转 sold；多件判断 sold_count
    db.prepare("UPDATE market_items SET status='sold', sold_at=? WHERE id=? AND stock=1").run(nowIso(), order.item_id);
    db.prepare("UPDATE market_items SET status='sold' WHERE id=? AND stock>1 AND sold_count>=stock").run(order.item_id);

    // 信誉事件：完成 + 实时重算
    db.prepare("INSERT OR IGNORE INTO market_reputation_events (user_id, order_id, event, created_at) VALUES (?, ?, 'completion', ?)").run(order.seller_id, orderId, nowIso());
    recomputeReputation(order.seller_id);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

export function cancelOrder(buyerId, orderId) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', status: 404 };
  if (order.buyer_id !== buyerId) return { error: '不是你的订单', status: 403 };
  if (order.status !== 'pending_payment') return { error: '当前状态不可取消', status: 409 };

  const r = runTx(() => {
    db.prepare("UPDATE market_orders SET status='cancelled', cancelled_at=? WHERE id=? AND status='pending_payment'").run(nowIso(), orderId);
    // 商品回 active（若还开市）或 expired
    db.prepare("UPDATE market_items SET status='active', reserved_order_id=NULL WHERE id=? AND status='reserved'").run(order.item_id);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

export function refundOrder(orderId) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', status: 404 };
  if (!['paid_escrow', 'delivered', 'disputed'].includes(order.status)) return { error: '当前状态不可退款', status: 409 };

  const itemSessionId = db.prepare('SELECT session_id FROM market_items WHERE id=?').get(order.item_id)?.session_id;
  const key = `order:${orderId}:refund`;
  const r = runTx(() => {
    db.prepare("UPDATE market_orders SET status='refunded', cancelled_at=? WHERE id=? AND status IN ('paid_escrow','delivered','disputed')").run(nowIso(), orderId);
    const coin = applyCoinRaw({ fromUserId: order.buyer_id, amount: order.price_coin, type: 'refund', relatedType: 'market_order', relatedId: orderId, idempotencyKey: key });
    if (coin.error) throwBiz(coin.code, coin.error, coin.status);
    writeLedger({ sessionId: itemSessionId, bizType: 'order_refund', bizId: orderId, op: 'refund', userId: order.buyer_id, amount: order.price_coin, coinTxId: coin.txId, idempotencyKey: `${key}:ledger` });
    // 商品回 active / expired（单件）
    db.prepare("UPDATE market_items SET status='active', reserved_order_id=NULL WHERE id=? AND status='reserved'").run(order.item_id);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// ============================================================
// 砍价
// ============================================================

export function createBargain(buyerId, itemId, offerCoin) {
  const sys = assertNotSystem(buyerId);
  if (sys) return sys;
  const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(itemId);
  if (!item) return { error: '商品不存在', status: 404 };
  if (item.seller_id === buyerId) return { error: '不能砍自己的商品', status: 400 };
  const session = getSession(item.session_id);
  assertOpen(session);

  const offer = Number(offerCoin);
  if (!Number.isInteger(offer) || offer <= 0 || offer >= item.price_coin) return { error: '出价无效（需为正整数且低于标价）', status: 400 };

  const key = `bargain:${itemId}:${buyerId}`;
  const r = runTx(() => {
    const attempt = db.prepare('SELECT COALESCE(MAX(attempt_no), 0) + 1 AS n FROM market_bargains WHERE item_id=? AND buyer_id=?').get(itemId, buyerId).n;
    const coin = applyCoinRaw({ fromUserId: buyerId, amount: offer, type: 'freeze', relatedType: 'market_bargain', relatedId: itemId, idempotencyKey: `${key}:${attempt}` });
    if (coin.error) throwBiz(coin.code, coin.error, coin.status);
    const info = db.prepare("INSERT INTO market_bargains (item_id, buyer_id, seller_id, attempt_no, offer_coin, frozen_key, idempotency_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
      .run(itemId, buyerId, item.seller_id, attempt, offer, `${key}:${attempt}`, `${key}:${attempt}`, nowIso());
    writeLedger({ sessionId: item.session_id, bizType: 'bargain_freeze', bizId: Number(info.lastInsertRowid), op: 'freeze', userId: buyerId, amount: offer, coinTxId: coin.txId, idempotencyKey: `${key}:${attempt}:ledger` });
    return { bargainId: Number(info.lastInsertRowid) };
  });
  if (r.error) return r;
  return { ok: true, bargainId: r.value.bargainId };
}

export function acceptBargain(sellerId, bargainId) {
  const bargain = db.prepare('SELECT * FROM market_bargains WHERE id=?').get(bargainId);
  if (!bargain) return { error: '砍价不存在', status: 404 };
  if (bargain.seller_id !== sellerId) return { error: '不是你的商品', status: 403 };
  if (bargain.status !== 'pending') return { error: '当前状态不可接受', status: 409 };
  const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(bargain.item_id);
  const session = getSession(item.session_id);
  assertOpen(session);

  const payDeadline = new Date(Date.now() + cfg('bargainPayHours') * 3600000).toISOString();
  const key = `bargain:${bargainId}:accept`;
  const r = runTx(() => {
    // 锁定商品
    const up = db.prepare("UPDATE market_items SET status='reserved', reserved_order_id=NULL WHERE id=? AND status='active'").run(item.id);
    if (up.changes === 0) throwBiz('ITEM_NOT_AVAILABLE', '商品不可用', 409);

    db.prepare("UPDATE market_bargains SET status='accepted', accepted_at=?, expires_at=? WHERE id=? AND status='pending'").run(nowIso(), payDeadline, bargainId);

    // 其余 pending 砍价：过期 + 退款
    const others = db.prepare("SELECT * FROM market_bargains WHERE item_id=? AND status='pending' AND id!=?").all(item.id, bargainId);
    for (const o of others) {
      const rk = `bargain:${o.id}:expire`;
      const coin = applyCoinRaw({ fromUserId: o.buyer_id, amount: o.offer_coin, type: 'refund', relatedType: 'market_bargain', relatedId: o.id, idempotencyKey: rk });
      if (!coin.error) {
        db.prepare("UPDATE market_bargains SET status='expired' WHERE id=?").run(o.id);
        writeLedger({ sessionId: item.session_id, bizType: 'bargain_unfreeze', bizId: o.id, op: 'refund', userId: o.buyer_id, amount: o.offer_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
      }
    }

    // 生成待支付订单
    const fee = Math.floor(bargain.offer_coin * (cfg('tradeFeeRate') ?? config.coin.tradeFeeRate));
    const info = db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, bargain_id, price_coin, fee_coin, status, pay_deadline_at, idempotency_key, created_at) VALUES (?, ?, ?, 'bargain', ?, ?, ?, 'pending_payment', ?, ?, ?)")
      .run(item.id, bargain.buyer_id, sellerId, bargainId, bargain.offer_coin, fee, payDeadline, `${key}:order`, nowIso());
    const orderId = Number(info.lastInsertRowid);
    db.prepare('UPDATE market_items SET reserved_order_id=? WHERE id=?').run(orderId, item.id);
    return { orderId };
  });
  if (r.error) return r;
  return { ok: true, orderId: r.value.orderId };
}

export function rejectBargain(sellerId, bargainId) {
  const bargain = db.prepare('SELECT * FROM market_bargains WHERE id=?').get(bargainId);
  if (!bargain) return { error: '砍价不存在', status: 404 };
  if (bargain.seller_id !== sellerId) return { error: '不是你的商品', status: 403 };
  if (bargain.status !== 'pending') return { error: '当前状态不可拒绝', status: 409 };

  const key = `bargain:${bargainId}:reject`;
  const r = runTx(() => {
    db.prepare("UPDATE market_bargains SET status='rejected' WHERE id=? AND status='pending'").run(bargainId);
    const coin = applyCoinRaw({ fromUserId: bargain.buyer_id, amount: bargain.offer_coin, type: 'refund', relatedType: 'market_bargain', relatedId: bargainId, idempotencyKey: key });
    if (coin.error) throwBiz(coin.code, coin.error, coin.status);
    writeLedger({ sessionId: null, bizType: 'bargain_unfreeze', bizId: bargainId, op: 'refund', userId: bargain.buyer_id, amount: bargain.offer_coin, coinTxId: coin.txId, idempotencyKey: `${key}:ledger` });
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// 卖家待处理砍价列表（砍价收件箱数据源，纯只读）
export function listSellerBargains(userId) {
  return db.prepare(`
    SELECT b.id, b.item_id, i.title AS item_title, i.price_coin AS item_price,
           b.buyer_id, u.nickname AS buyer_name, u.avatar AS buyer_avatar,
           b.offer_coin, b.attempt_no, b.status, b.created_at, b.expires_at
    FROM market_bargains b
    JOIN market_items i ON i.id = b.item_id
    JOIN users u ON u.id = b.buyer_id
    WHERE b.seller_id = ? AND b.status = 'pending'
    ORDER BY b.created_at DESC
  `).all(userId).map(mapBargain);
}

// ============================================================
// 盲盒
// ============================================================

export function openBlindbox(buyerId, orderId) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', status: 404 };
  if (order.buyer_id !== buyerId) return { error: '不是你的订单', status: 403 };
  if (order.type !== 'blindbox') return { error: '不是盲盒订单', status: 400 };
  if (order.status !== 'paid_escrow') return { error: '当前状态不可开盒', status: 409 };

  const bc = db.prepare('SELECT * FROM market_blindbox_configs WHERE item_id=?').get(order.item_id);
  const itemSessionId = db.prepare('SELECT session_id FROM market_items WHERE id=?').get(order.item_id)?.session_id;
  const holdUntil = new Date(Date.now() + cfg('blindboxHoldHours') * 3600000).toISOString();

  const r = runTx(() => {
    db.prepare('INSERT INTO market_blindbox_opens (order_id, item_id, buyer_id, opened_result_json, opened_value_coin, opened_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(orderId, order.item_id, buyerId, bc.content_json, bc.min_value_coin, nowIso(), nowIso());
    db.prepare("UPDATE market_blindbox_configs SET status='held', hold_until=? WHERE item_id=?").run(holdUntil, order.item_id);
    // 开盒即视为收货完成（盲盒开盒即成交，保证金托管 24h）
    db.prepare("UPDATE market_orders SET status='completed', completed_at=? WHERE id=? AND status='paid_escrow'").run(nowIso(), orderId);
    // 盲盒开盒即成交，同样记 completion 事件（与 confirmOrder 对齐）
    db.prepare("INSERT OR IGNORE INTO market_reputation_events (user_id, order_id, event, created_at) VALUES (?, ?, 'completion', ?)").run(order.seller_id, orderId, nowIso());
    recomputeReputation(order.seller_id);
    // 盲盒开盒即划账（charge）：托管 → 卖家 + 手续费
    const fee = order.fee_coin;
    const net = order.price_coin - fee;
    const key = `order:${orderId}:open`;
    if (net > 0) {
      const t = applyCoinRaw({ fromUserId: buyerId, toUserId: order.seller_id, amount: net, type: 'transfer', relatedType: 'market_order', relatedId: orderId, idempotencyKey: `${key}:transfer` });
      if (t.error) throwBiz(t.code, t.error, t.status);
      writeLedger({ sessionId: itemSessionId, bizType: 'order_charge', bizId: orderId, op: 'charge', userId: order.seller_id, counterpartyId: buyerId, amount: net, coinTxId: t.txId, idempotencyKey: `${key}:ledger:charge` });
    }
    if (fee > 0) {
      const feeKey = `fee_treasury:${orderId}`;
      const t = applyCoinRaw({ fromUserId: buyerId, toUserId: systemAccountId(), amount: fee, type: 'transfer', relatedType: 'market_order', relatedId: orderId, idempotencyKey: feeKey });
      if (t.error) throwBiz(t.code, t.error, t.status);
      writeLedger({ sessionId: itemSessionId, bizType: 'fee_treasury', bizId: orderId, op: 'treasury_in', userId: buyerId, counterpartyId: systemAccountId(), amount: fee, coinTxId: t.txId, idempotencyKey: `${feeKey}:ledger` });
    }
    db.prepare("UPDATE market_items SET status='sold', sold_at=? WHERE id=? AND stock=1").run(nowIso(), order.item_id);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// ============================================================
// 店铺竞拍（简版：价高者得，周期结算由 settleShopTerms 处理）
// ============================================================

export function bidShop(userId, shopId, termWeek, amountCoin) {
  const sys = assertNotSystem(userId);
  if (sys) return sys;
  const amount = Number(amountCoin);
  if (!Number.isInteger(amount) || amount <= 0) return { error: '出价必须为正整数', status: 400 };
  const shop = db.prepare('SELECT * FROM market_shops WHERE id=?').get(shopId);
  if (!shop) return { error: '店铺不存在', status: 404 };

  // 校验期次：格式必须为 YYYY-Www，且截止时间未过（拒绝绕过前端 gate 对过期期出价）
  const deadline = termWeekStartIso(termWeek);
  if (!deadline) return { error: '期次格式无效', status: 400 };
  if (new Date(deadline).getTime() <= Date.now()) return { error: '该期竞拍已截止', code: 'AUCTION_TERM_CLOSED', status: 409 };

  const key = `shop_bid:${shopId}:${termWeek}:${userId}`;
  const r = runTx(() => {
    const existing = db.prepare('SELECT * FROM market_shop_bids WHERE shop_id=? AND term_week=? AND user_id=?').get(shopId, termWeek, userId);
    let delta = amount;
    if (existing) {
      delta = amount - existing.amount_coin;
      if (delta <= 0) return { ok: true, bid: existing };
    }
    const coin = applyCoinRaw({ fromUserId: userId, amount: delta, type: 'freeze', relatedType: 'market_shop_bid', relatedId: shopId, idempotencyKey: `${key}:${amount}` });
    if (coin.error) throwBiz(coin.code, coin.error, coin.status);

    if (existing) {
      db.prepare('UPDATE market_shop_bids SET amount_coin=?, frozen_total_coin=?, frozen_key=? WHERE id=?').run(amount, existing.frozen_total_coin + delta, `${key}:${amount}`, existing.id);
    } else {
      db.prepare("INSERT INTO market_shop_bids (shop_id, term_week, user_id, amount_coin, frozen_total_coin, frozen_key, idempotency_key, deadline_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)")
        .run(shopId, termWeek, userId, amount, delta, `${key}:${amount}`, key, termWeekStartIso(termWeek), nowIso());
    }
    writeLedger({ sessionId: null, bizType: 'shop_bid', bizId: shopId, op: 'freeze', userId, amount: delta, coinTxId: coin.txId, idempotencyKey: `${key}:${amount}:ledger` });
    return { ok: true };
  });
  if (r.error) return r;
  return { ok: true };
}

export function settleShopTerms(termWeek) {
  const shops = db.prepare('SELECT * FROM market_shops ORDER BY shop_no ASC').all();
  const r = db.transaction(() => {
    for (const shop of shops) {
      const bids = db.prepare("SELECT * FROM market_shop_bids WHERE shop_id=? AND term_week=? AND status='active' ORDER BY amount_coin DESC, id ASC").all(shop.id, termWeek);
      const winner = bids[0];
      const term = db.prepare('SELECT * FROM market_shop_terms WHERE shop_id=? AND term_week=?').get(shop.id, termWeek);
      if (winner && !term) {
        db.prepare("INSERT INTO market_shop_terms (shop_id, term_week, owner_id, rent_coin, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)").run(shop.id, termWeek, winner.user_id, winner.amount_coin, nowIso());
        // 中标：冻结全额作为租金，50% transfer 给 SYSTEM，50% sink 销毁（顺序固定）
        const treasuryPart = Math.floor(winner.frozen_total_coin * cfg('stallFeeTreasuryRatio'));
        const sinkPart = winner.frozen_total_coin - treasuryPart;
        if (treasuryPart > 0) {
          const sysId = systemAccountId();
          const tKey = `shop_rent_treasury:${shop.id}:${termWeek}`;
          const t = applyCoinRaw({ fromUserId: winner.user_id, toUserId: sysId, amount: treasuryPart, type: 'transfer', relatedType: 'market_shop_rent', relatedId: shop.id, idempotencyKey: tKey });
          if (t.error) throwBiz(t.code, t.error, t.status);
          writeLedger({ sessionId: null, bizType: 'shop_rent_treasury', bizId: shop.id, op: 'treasury_in', userId: winner.user_id, counterpartyId: sysId, amount: treasuryPart, coinTxId: t.txId, idempotencyKey: `${tKey}:ledger` });
        }
        if (sinkPart > 0) {
          const rf = applyCoinRaw({ fromUserId: winner.user_id, amount: sinkPart, type: 'refund', relatedType: 'market_shop_rent', relatedId: shop.id, idempotencyKey: `shop_rent:${shop.id}:${termWeek}:${winner.user_id}:unfreeze` });
          if (rf.error) throwBiz(rf.code, rf.error, rf.status);
          const sk = applyCoinRaw({ fromUserId: winner.user_id, amount: sinkPart, type: 'sink', relatedType: 'market_shop_rent', relatedId: shop.id, idempotencyKey: `shop_rent:${shop.id}:${termWeek}:${winner.user_id}:sink` });
          if (sk.error) throwBiz(sk.code, sk.error, sk.status);
          writeLedger({ sessionId: null, bizType: 'shop_rent_sink', bizId: shop.id, op: 'sink', userId: winner.user_id, amount: sinkPart, coinTxId: sk.txId, idempotencyKey: `shop_rent:${shop.id}:${termWeek}:${winner.user_id}:sink:ledger` });
        }
        db.prepare("UPDATE market_shop_bids SET status='won' WHERE id=?").run(winner.id);
      }
      // 未中标：全额退款
      for (const b of bids) {
        if (winner && b.id === winner.id) continue;
        const rk = `shop_bid_refund:${b.id}`;
        const coin = applyCoinRaw({ fromUserId: b.user_id, amount: b.frozen_total_coin, type: 'refund', relatedType: 'market_shop_bid', relatedId: b.id, idempotencyKey: rk });
        if (!coin.error) {
          db.prepare("UPDATE market_shop_bids SET status='refunded' WHERE id=?").run(b.id);
          writeLedger({ sessionId: null, bizType: 'shop_bid', bizId: b.id, op: 'refund', userId: b.user_id, amount: b.frozen_total_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
        }
      }
    }
    return true;
  })();
  return { ok: true };
}

// 读取店铺竞拍面板：当期 termWeek + 截止 + 每店最高价 / 我的出价（纯只读）
export function listShops(userId) {
  const now = new Date(); // 同一 now 贯穿 termWeek/deadline/serverTime，避免毫秒级漂移
  const { termWeek, deadlineAt } = auctionTerm(now);
  const shops = db.prepare('SELECT * FROM market_shops ORDER BY sort_order ASC').all();
  const terms = db.prepare("SELECT * FROM market_shop_terms WHERE status='active'").all();
  const termMap = new Map(terms.map((t) => [t.shop_id, t]));
  return {
    termWeek,
    deadlineAt,
    serverTime: now.toISOString(),
    shops: shops.map((s) => {
      const highestBid = db.prepare("SELECT COALESCE(MAX(amount_coin), 0) AS v FROM market_shop_bids WHERE shop_id=? AND term_week=? AND status='active'").get(s.id, termWeek).v;
      const bidCount = db.prepare("SELECT COUNT(*) AS c FROM market_shop_bids WHERE shop_id=? AND term_week=? AND status='active'").get(s.id, termWeek).c;
      const myRow = db.prepare("SELECT amount_coin FROM market_shop_bids WHERE shop_id=? AND term_week=? AND user_id=? AND status='active'").get(s.id, termWeek, userId);
      return { ...s, term: termMap.get(s.id) || null, highestBid, bidCount, myBid: myRow ? myRow.amount_coin : null };
    }),
  };
}

// ============================================================
// 喇叭 / 纠纷 / 秒杀 / 结算
// ============================================================

export function broadcast(userId, sessionId, content, stallId = null) {
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  assertOpen(session);
  const text = (content || '').toString().trim();
  if (!text || text.length > 100) return { error: '喇叭内容需为 1-100 字', status: 400 };
  if (containsSensitiveWord(text)) return { error: '内容包含违规词，请修改', code: 'SENSITIVE_CONTENT', status: 400 };

  const seq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM market_broadcasts WHERE session_id=? AND user_id=?').get(sessionId, userId).n;
  if (seq > cfg('broadcastPerUserPerSession')) return { error: '本期喇叭已达上限', status: 409 };

  const fee = cfg('broadcast_fee') ?? 0;
  const key = `broadcast:${sessionId}:${userId}:${seq}`;
  const r = runTx(() => {
    if (fee > 0) {
      const sysId = systemAccountId();
      const p = applyCoinRaw({ fromUserId: userId, toUserId: sysId, amount: fee, type: 'pay', relatedType: 'market_broadcast', relatedId: sessionId, idempotencyKey: key });
      if (p.error) throwBiz(p.code, p.error, p.status);
      writeLedger({ sessionId, bizType: 'broadcast_fee', bizId: null, op: 'treasury_in', userId, counterpartyId: sysId, amount: fee, coinTxId: p.txId, idempotencyKey: `${key}:ledger` });
    }
    db.prepare("INSERT INTO market_broadcasts (session_id, user_id, seq, stall_id, content, fee_coin, status, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, 'published', ?, ?)")
      .run(sessionId, userId, seq, stallId, text, fee, key, nowIso());
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// 全服喇叭列表（滚动条数据源，纯只读）：近 20 条 published，时间正序（子查询先倒序取最近，再正序）
// myCount 统计本期该用户全部喇叭（含 removed，用过即计入），与上限判断口径一致
export function listBroadcasts(sessionId, userId) {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT b.id, b.session_id, b.user_id, b.content, b.fee_coin, b.stall_id, b.created_at, u.nickname
      FROM market_broadcasts b
      JOIN users u ON u.id = b.user_id
      WHERE b.session_id = ? AND b.status = 'published'
      ORDER BY b.id DESC
      LIMIT 20
    ) ORDER BY id ASC
  `).all(sessionId);
  const myCount = db.prepare('SELECT COUNT(*) AS c FROM market_broadcasts WHERE session_id = ? AND user_id = ?').get(sessionId, userId).c;
  return {
    fee: cfg('broadcast_fee') ?? 0,
    limit: cfg('broadcastPerUserPerSession'),
    myCount,
    broadcasts: rows.map((r) => ({
      id: r.id, sessionId: r.session_id, userId: r.user_id, nickname: r.nickname,
      content: r.content, feeCoin: r.fee_coin, stallId: r.stall_id, createdAt: r.created_at,
    })),
  };
}

export function createDispute(reporterId, { orderId = null, itemId = null, type = 'report', reason, evidenceJson = null }) {
  const rtext = (reason || '').toString().trim();
  if (!rtext) return { error: '请填写举报原因', status: 400 };
  if (containsSensitiveWord(rtext)) return { error: '内容包含违规词，请修改', code: 'SENSITIVE_CONTENT', status: 400 };
  if (typeof evidenceJson === 'string' && containsSensitiveWord(evidenceJson)) return { error: '内容包含违规词，请修改', code: 'SENSITIVE_CONTENT', status: 400 };

  // 盲盒 24h 窗口（仅 type='blindbox' 订单）
  if (orderId) {
    const order = db.prepare('SELECT type FROM market_orders WHERE id=?').get(orderId);
    if (order && order.type === 'blindbox') {
      const open = db.prepare('SELECT opened_at FROM market_blindbox_opens WHERE order_id=?').get(orderId);
      if (open) {
        const deadline = new Date(new Date(open.opened_at).getTime() + cfg('blindboxHoldHours') * 3600000);
        if (deadline.getTime() < Date.now()) {
          return { error: '盲盒举报已超过开盒后 24 小时', code: 'REPORT_WINDOW_EXPIRED', status: 400 };
        }
      }
    }
  }

  const reportKey = orderId ? `order:${orderId}:${reporterId}` : `item:${itemId}:${reporterId}`;
  // month_key 用服务端 UTC 时间，防改时区跨月重置
  const nowD = new Date();
  const monthKey = `${nowD.getUTCFullYear()}-${String(nowD.getUTCMonth() + 1).padStart(2, '0')}`;

  const r = runTx(() => {
    // 1. 先 INSERT dispute（report_key UNIQUE 拦截重复 → 409，counter 不增加）
    try {
      db.prepare("INSERT INTO market_disputes (order_id, item_id, reporter_id, report_key, type, reason, evidence_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
        .run(orderId, itemId, reporterId, reportKey, type, rtext, evidenceJson, nowIso());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throwBiz('REPORTED', '你已举报过该对象', 409);
      throw e;
    }
    // 2. counter upsert（先 dispute 后 counter）
    db.prepare('INSERT INTO report_counters (user_id, month_key, count) VALUES (?, ?, 1) ON CONFLICT(user_id, month_key) DO UPDATE SET count = count + 1').run(reporterId, monthKey);
    // 3. 达 limit 整体回滚（dispute 也回滚）→ 429
    const c = db.prepare('SELECT count FROM report_counters WHERE user_id=? AND month_key=?').get(reporterId, monthKey).count;
    if (c > cfg('reportMonthlyLimit')) throwBiz('REPORT_LIMIT_EXCEEDED', '本月举报次数已达上限', 429);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

export function resolveDispute(adminId, disputeId, outcome) {
  const dispute = db.prepare('SELECT * FROM market_disputes WHERE id=?').get(disputeId);
  if (!dispute) return { error: '纠纷不存在', status: 404 };
  const r = runTx(() => {
    db.prepare('UPDATE market_disputes SET status=?, resolved_by=?, resolved_at=? WHERE id=?').run(outcome, adminId, nowIso(), disputeId);
    if (outcome === 'resolved_buyer' && dispute.order_id) {
      // 买家胜诉 = 卖家败诉，记 dispute_lost 事件（幂等键 order_id + event + seller_id）
      const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(dispute.order_id);
      if (order) {
        db.prepare("INSERT OR IGNORE INTO market_reputation_events (user_id, order_id, event, created_at) VALUES (?, ?, 'dispute_lost', ?)").run(order.seller_id, dispute.order_id, nowIso());
        recomputeReputation(order.seller_id);
        const bc = db.prepare('SELECT * FROM market_blindbox_configs WHERE item_id=?').get(order.item_id);
        if (bc) {
          const itemSessionId = db.prepare('SELECT session_id FROM market_items WHERE id=?').get(order.item_id)?.session_id;
          db.prepare("UPDATE market_blindbox_configs SET status='forfeited', penalty_coin=?, released_at=? WHERE item_id=? AND status='held'").run(bc.min_value_coin, nowIso(), order.item_id);
          // 从卖家冻结保证金 transfer 给买家（frozen → coin）
          const coin = applyCoinRaw({ fromUserId: order.seller_id, toUserId: order.buyer_id, amount: bc.min_value_coin, type: 'transfer', relatedType: 'market_dispute', relatedId: disputeId, idempotencyKey: `dispute:${disputeId}:compensate` });
          if (!coin.error) writeLedger({ sessionId: itemSessionId, bizType: 'dispute_compensate', bizId: disputeId, op: 'compensate', userId: order.buyer_id, counterpartyId: order.seller_id, amount: bc.min_value_coin, coinTxId: coin.txId, idempotencyKey: `dispute:${disputeId}:compensate:ledger` });
        }
      }
    }
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// 我的举报（举报方视角）：本月计数 + 可举报盲盒订单 + 历史记录
// used 读 report_counters（与 POST 限流同源，避免 dispute 被删导致口径漂移）
export function listMyDisputes(userId) {
  const limit = cfg('reportMonthlyLimit');
  const monthKey = (() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  })();
  const used = db.prepare('SELECT count FROM report_counters WHERE user_id=? AND month_key=?').get(userId, monthKey)?.count ?? 0;

  // 可举报盲盒订单：开盒后 blindboxHoldHours 内、且我未举报过
  const holdMs = cfg('blindboxHoldHours') * 3600000;
  const nowMs = Date.now();
  const reportable = db.prepare(`
    SELECT o.id AS order_id, o.item_id, i.title, bo.opened_at, bo.opened_value_coin
    FROM market_orders o
    JOIN market_items i ON i.id = o.item_id
    JOIN market_blindbox_opens bo ON bo.order_id = o.id
    WHERE o.buyer_id = ? AND o.type = 'blindbox'
      AND NOT EXISTS (SELECT 1 FROM market_disputes d WHERE d.order_id = o.id AND d.reporter_id = o.buyer_id)
    ORDER BY bo.opened_at DESC
  `).all(userId)
    .map((r) => ({
      orderId: r.order_id,
      itemId: r.item_id,
      title: r.title,
      valueCoin: r.opened_value_coin,
      deadlineAt: new Date(new Date(r.opened_at).getTime() + holdMs).toISOString(),
    }))
    .filter((r) => new Date(r.deadlineAt).getTime() > nowMs);

  const disputes = db.prepare('SELECT * FROM market_disputes WHERE reporter_id=? ORDER BY id DESC').all(userId)
    .map((d) => ({
      id: d.id, orderId: d.order_id, itemId: d.item_id, type: d.type,
      reason: d.reason, evidenceJson: d.evidence_json, status: d.status, createdAt: d.created_at,
    }));

  return { limit, used, remaining: Math.max(0, limit - used), reportable, disputes };
}

// 买家评价卖家（1-5 星），completed 后 rateWindowDays 天内可评，幂等 (order_id,'rating',seller_id)
export function rateOrder(buyerId, orderId, rating) {
  const order = db.prepare('SELECT * FROM market_orders WHERE id=?').get(orderId);
  if (!order) return { error: '订单不存在', code: 'ORDER_NOT_FOUND', status: 404 };
  if (order.buyer_id !== buyerId) return { error: '不是你的订单', code: 'NOT_BUYER', status: 403 };
  if (order.status !== 'completed') return { error: '订单未完成，暂不可评价', code: 'ORDER_NOT_COMPLETED', status: 400 };
  const deadline = new Date(new Date(order.completed_at).getTime() + cfg('rateWindowDays') * 86400000);
  if (deadline.getTime() < Date.now()) return { error: '已超过评价期限', code: 'RATE_WINDOW_EXPIRED', status: 400 };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: '评分需为 1-5 的整数', code: 'INVALID_RATING', status: 400 };

  const r = runTx(() => {
    try {
      // 事件 user_id = 卖家（被评者）；UNIQUE(order_id,event,user_id) 拦截重复 → 409
      db.prepare("INSERT INTO market_reputation_events (user_id, order_id, event, rating, created_at) VALUES (?, ?, 'rating', ?, ?)")
        .run(order.seller_id, orderId, rating, nowIso());
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throwBiz('ALREADY_RATED', '你已评价过该订单', 409);
      throw e;
    }
    recomputeReputation(order.seller_id);
    return true;
  });
  if (r.error) return r;
  return { ok: true };
}

// 信誉等级判定（纯函数，供聚合与边界测试复用）：顺序不可乱
export function reputeLevel(orderCount, score) {
  if (orderCount < 5) return 'new';
  if (score >= 90 && orderCount >= 20) return 'veteran';
  if (score >= 80) return 'trusted';
  if (score >= 60) return 'regular';
  return 'risky';
}

// 重算卖家信誉（实时聚合，基于 market_orders 状态 + market_reputation_events 事件）
export function recomputeReputation(sellerId) {
  const orders = db.prepare("SELECT status, COUNT(*) AS c FROM market_orders WHERE seller_id=? AND status IN ('completed','cancelled','refunded') GROUP BY status").all(sellerId);
  const by = {};
  for (const r of orders) by[r.status] = r.c;
  const completed = by.completed ?? 0;
  const cancelled = by.cancelled ?? 0;
  const refunded = by.refunded ?? 0;
  const orderCount = completed; // 权威成交数（cancelled/refunded 不计入量级）

  const ratingRow = db.prepare("SELECT COUNT(*) AS rated, COALESCE(SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END), 0) AS good FROM market_reputation_events WHERE user_id=? AND event='rating'").get(sellerId);
  const ratedCount = ratingRow.rated;
  const goodCount = ratingRow.good;
  const disputeLost = db.prepare("SELECT COUNT(*) AS c FROM market_reputation_events WHERE user_id=? AND event='dispute_lost'").get(sellerId).c;

  // rates（REAL，不提前取整，只在最终 score 时 Math.round）
  const goodRate = (goodCount + 5) / (ratedCount + 10); // Laplace：0 评价 = 0.5（中性）
  const totalTerminated = completed + cancelled + refunded;
  const completionRate = totalTerminated > 0 ? completed / totalTerminated : 1; // 语义：还没违约过
  const cancelRate = totalTerminated > 0 ? cancelled / totalTerminated : 0;      // v1 无卖家取消，恒 0
  const disputeLostRate = completed > 0 ? disputeLost / completed : 0;

  const protectedOrders = Math.max(0, 5 - orderCount); // 公式算，不用字段递减

  let score;
  if (protectedOrders > 0) {
    score = 70;
  } else {
    score = Math.round(Math.max(0, Math.min(100,
      70 + (goodRate - 0.5) * 40 - cancelRate * 30 - disputeLostRate * 50 + Math.min(orderCount, 40) * 0.5
    )));
  }

  const level = reputeLevel(orderCount, score);

  db.prepare(`
    INSERT INTO market_reputations (user_id, score, level, order_count, good_rate, completion_rate, cancel_rate, dispute_lost_rate, protected_orders, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      score=excluded.score, level=excluded.level, order_count=excluded.order_count,
      good_rate=excluded.good_rate, completion_rate=excluded.completion_rate,
      cancel_rate=excluded.cancel_rate, dispute_lost_rate=excluded.dispute_lost_rate,
      protected_orders=excluded.protected_orders, updated_at=excluded.updated_at
  `).run(sellerId, score, level, orderCount, goodRate, completionRate, cancelRate, disputeLostRate, protectedOrders, nowIso());

  return { score, goodRate, completionRate, cancelRate, disputeLostRate, orderCount, protectedOrders, level };
}

// 官方秒杀：SYSTEM 作为卖家发布，差价补贴走 budget_spend（模型 A）
export function createFlashSale(adminId, { sessionId, title, priceCoin, costCoin, stock }) {
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  const price = Number(priceCoin);
  const cost = Number(costCoin);
  if (!title || !Number.isInteger(price) || price <= 0 || !Number.isInteger(stock) || stock <= 0) return { error: '参数无效', status: 400 };
  if (!Number.isInteger(cost) || cost <= price) return { error: '原价必须为正整数且高于秒杀价', status: 400 };
  const key = `flash:${sessionId}:${randomBytes(8).toString('hex')}`;
  const info = db.prepare("INSERT INTO market_items (session_id, seller_id, type, title, price_coin, cost_coin, stock, status, is_official, idempotency_key, created_at) VALUES (?, ?, 'flash_sale', ?, ?, ?, ?, 'active', 1, ?, ?)")
    .run(sessionId, systemAccountId(), title, price, cost, stock, key, nowIso());
  return { itemId: Number(info.lastInsertRowid) };
}

// 闭市结算（幂等，settle_key 兜底）
export function settleSession(sessionId) {
  const session = getSession(sessionId);
  if (!session) return { error: '期次不存在', status: 404 };
  if (session.settled_at) return { ok: true, settled: false };

  const key = `settle:${sessionId}`;
  const r = runTx(() => {
    const up = db.prepare('UPDATE market_sessions SET settle_key=?, settle_at=? WHERE id=? AND settle_key IS NULL').run(key, nowIso(), sessionId);
    if (up.changes === 0) return { settled: false };

    // 未售商品过期
    db.prepare("UPDATE market_items SET status='expired' WHERE session_id=? AND status IN ('active','reserved')").run(sessionId);
    // 未接受砍价过期 + 退款
    const pendingBargains = db.prepare("SELECT * FROM market_bargains WHERE item_id IN (SELECT id FROM market_items WHERE session_id=?) AND status='pending'").all(sessionId);
    for (const b of pendingBargains) {
      const rk = `bargain:${b.id}:settle-expire`;
      const coin = applyCoinRaw({ fromUserId: b.buyer_id, amount: b.offer_coin, type: 'refund', relatedType: 'market_bargain', relatedId: b.id, idempotencyKey: rk });
      if (!coin.error) {
        db.prepare("UPDATE market_bargains SET status='expired' WHERE id=?").run(b.id);
        writeLedger({ sessionId, bizType: 'bargain_unfreeze', bizId: b.id, op: 'refund', userId: b.buyer_id, amount: b.offer_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
      }
    }
    // 流动地摊押金退还
    const stalls = db.prepare("SELECT * FROM market_stalls WHERE session_id=? AND status IN ('occupied','expired')").all(sessionId);
    for (const s of stalls) {
      if (s.owner_id && s.deposit_coin > 0) {
        const rk = `stall_deposit_refund:${s.id}`;
        const coin = applyCoinRaw({ fromUserId: s.owner_id, amount: s.deposit_coin, type: 'refund', relatedType: 'market_stall_deposit', relatedId: s.id, idempotencyKey: rk });
        if (!coin.error) writeLedger({ sessionId, bizType: 'stall_refund', bizId: s.id, op: 'refund', userId: s.owner_id, amount: s.deposit_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
      }
    }
    db.prepare("UPDATE market_sessions SET status='settled' WHERE id=?").run(sessionId);
    return { settled: true };
  });
  if (r.error) return r;
  return { ok: true, settled: r.value.settled };
}

// ============================================================
// 定时任务（幂等，崩溃重入不重复退款/释放）
// ============================================================

// 日期 → ISO 周字符串 'YYYY-Www'（周一为一周起点）
export function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 移到本周周四（ISO 年锚点）
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// 当前可竞拍的期次 = 下一个（严格未来的）周一 00:00 UTC 所在周
export function auctionTerm(now = new Date()) {
  const day = now.getUTCDay() || 7; // Mon=1..Sun=7
  const daysUntilMonday = (8 - day) % 7; // 0 表示今天就是周一
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilMonday));
  if (monday.getTime() <= now.getTime()) monday.setUTCDate(monday.getUTCDate() + 7); // 周一 00:00 整/已过 → 推到下一周
  return { termWeek: isoWeekOf(monday), deadlineAt: monday.toISOString() };
}

// ISO 周字符串 'YYYY-Www' → 该周周一 00:00（UTC）ISO 时间
function termWeekStartIso(termWeek) {
  const m = String(termWeek).match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // Mon=1..Sun=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1) + (week - 1) * 7);
  return monday.toISOString();
}

// 1) 流动地摊 30min 到期释放：未售商品 expired + 押金 refund
export function expireStalls(now) {
  const stalls = db.prepare("SELECT * FROM market_stalls WHERE status='occupied' AND expires_at IS NOT NULL AND expires_at < ?").all(now);
  let released = 0;
  for (const s of stalls) {
    const r = runTx(() => {
      const up = db.prepare("UPDATE market_stalls SET status='released', expires_at=NULL WHERE id=? AND status='occupied' AND expires_at < ?").run(s.id, now);
      if (up.changes === 0) return false;
      db.prepare("UPDATE market_items SET status='expired' WHERE stall_id=? AND status IN ('active','reserved')").run(s.id);
      if (s.owner_id && s.deposit_coin > 0) {
        const rk = `stall_deposit_refund:${s.id}`;
        const coin = applyCoinRaw({ fromUserId: s.owner_id, amount: s.deposit_coin, type: 'refund', relatedType: 'market_stall_deposit', relatedId: s.id, idempotencyKey: rk });
        if (!coin.error) writeLedger({ sessionId: s.session_id, bizType: 'stall_refund', bizId: s.id, op: 'refund', userId: s.owner_id, amount: s.deposit_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
      }
      return true;
    });
    if (r.value) released++;
  }
  return { released };
}

// 2) 砍价 24h 支付超时：订单 cancelled + 冻结退款 + 商品回 active/expired
export function expireBargainPayments(now) {
  const orders = db.prepare("SELECT * FROM market_orders WHERE status='pending_payment' AND pay_deadline_at IS NOT NULL AND pay_deadline_at < ?").all(now);
  let cancelled = 0;
  for (const o of orders) {
    const r = runTx(() => {
      const up = db.prepare("UPDATE market_orders SET status='cancelled', cancelled_at=? WHERE id=? AND status='pending_payment' AND pay_deadline_at < ?").run(nowIso(), o.id, now);
      if (up.changes === 0) return false;
      if (o.bargain_id) db.prepare("UPDATE market_bargains SET status='expired' WHERE id=?").run(o.bargain_id);
      const rk = `bargain_expire:${o.bargain_id || o.id}`;
      const coin = applyCoinRaw({ fromUserId: o.buyer_id, amount: o.price_coin, type: 'refund', relatedType: 'market_bargain', relatedId: o.bargain_id || o.id, idempotencyKey: rk });
      const item = db.prepare('SELECT * FROM market_items WHERE id=?').get(o.item_id);
      if (!coin.error) writeLedger({ sessionId: item?.session_id, bizType: 'bargain_unfreeze', bizId: o.bargain_id || o.id, op: 'refund', userId: o.buyer_id, amount: o.price_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
      const session = item ? getSession(item.session_id) : null;
      if (session && session.status === 'open') {
        db.prepare("UPDATE market_items SET status='active', reserved_order_id=NULL WHERE id=? AND status='reserved'").run(o.item_id);
      } else {
        db.prepare("UPDATE market_items SET status='expired', reserved_order_id=NULL WHERE id=? AND status='reserved'").run(o.item_id);
      }
      return true;
    });
    if (r.value) cancelled++;
  }
  return { cancelled };
}

// 3) 盲盒保证金 held→released：举报期过且无 pending 纠纷则退还保证金
export function releaseBlindboxHolds(now) {
  const helds = db.prepare("SELECT * FROM market_blindbox_configs WHERE status='held' AND hold_until IS NOT NULL AND hold_until < ?").all(now);
  let released = 0;
  for (const bc of helds) {
    const pendingDispute = db.prepare("SELECT id FROM market_disputes WHERE item_id=? AND status IN ('pending','reviewing') LIMIT 1").get(bc.item_id);
    if (pendingDispute) continue;
    const r = runTx(() => {
      const up = db.prepare("UPDATE market_blindbox_configs SET status='released', released_at=? WHERE id=? AND status='held'").run(nowIso(), bc.id);
      if (up.changes === 0) return false;
      const seller = db.prepare('SELECT seller_id, session_id FROM market_items WHERE id=?').get(bc.item_id);
      if (seller && bc.deposit_coin > 0) {
        const rk = `blindbox_release:${bc.item_id}`;
        const coin = applyCoinRaw({ fromUserId: seller.seller_id, amount: bc.deposit_coin, type: 'refund', relatedType: 'market_blindbox_deposit', relatedId: bc.item_id, idempotencyKey: rk });
        if (!coin.error) writeLedger({ sessionId: seller.session_id, bizType: 'blindbox_deposit_refund', bizId: bc.item_id, op: 'refund', userId: seller.seller_id, amount: bc.deposit_coin, coinTxId: coin.txId, idempotencyKey: `${rk}:ledger` });
      }
      return true;
    });
    if (r.value) released++;
  }
  return { released };
}

// 4) 店铺每周竞拍结算：到期 term_week 触发 settleShopTerms（幂等）
export function settleDueShopTerms(now) {
  const due = db.prepare("SELECT DISTINCT term_week FROM market_shop_bids WHERE status='active' AND deadline_at IS NOT NULL AND deadline_at < ?").all(now);
  for (const d of due) settleShopTerms(d.term_week);
  return { settled: due.map((d) => d.term_week) };
}

// ============================================================
// 路由
// ============================================================

// 运行时配置快照（供 /market/session 返回给前端）；比率均走 cfg() 以支持 market_configs 覆盖
export function marketSessionConfig() {
  return {
    depositCoin: cfg('depositCoin'),
    broadcastFee: cfg('broadcast_fee') ?? 0,
    flashSaleBudget: cfg('flashSaleBudget'),
    tradeFeeRate: cfg('tradeFeeRate') ?? config.coin.tradeFeeRate,
    blindboxDepositRatio: cfg('blindboxDepositRatio'),
    blindboxMinValueRatio: cfg('blindboxMinValueRatio'),
  };
}

router.get('/market/session', (req, res) => {
  const session = currentSession();
  res.json({
    session,
    serverTime: nowIso(),
    treasury: getSystemBalance(),
    config: marketSessionConfig(),
  });
});

router.get('/market/stalls', (req, res) => {
  const sessionId = Number(req.query.sessionId) || currentSession()?.id;
  const stalls = db.prepare('SELECT * FROM market_stalls WHERE session_id=? ORDER BY stall_no ASC').all(sessionId);
  res.json(stalls);
});

router.get('/market/orders/mine', (req, res) => {
  const bought = db.prepare('SELECT o.*, i.title, i.type AS item_type FROM market_orders o JOIN market_items i ON i.id=o.item_id WHERE o.buyer_id=? ORDER BY o.id DESC').all(req.user.id);
  const sold = db.prepare('SELECT o.*, i.title, i.type AS item_type FROM market_orders o JOIN market_items i ON i.id=o.item_id WHERE o.seller_id=? ORDER BY o.id DESC').all(req.user.id);
  res.json({ bought, sold });
});

router.get('/market/bargains/mine', requireRole('student', 'admin'), (req, res) => {
  res.json(listSellerBargains(req.user.id));
});

router.get('/market/shops', (req, res) => {
  res.json(listShops(req.user.id));
});

router.post('/market/sessions', requireRole('admin'), (req, res) => {
  const r = createSession(req.body?.openAt);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(201).json(r.session);
});

router.post('/market/stalls/signup', requireRole('student', 'admin'), (req, res) => {
  const r = signupStall(req.user.id, Number(req.body?.sessionId));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/stalls/grab', requireRole('student', 'admin'), (req, res) => {
  const r = grabStall(req.user.id, Number(req.body?.sessionId));
  if (r.error) return res.status(r.status).json({ error: r.error, code: r.code });
  res.json(r);
});

router.post('/market/stalls/:id/confirm', requireRole('student', 'admin'), (req, res) => {
  const r = confirmStall(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, code: r.code });
  res.json(r);
});

router.post('/market/stalls/:id/release', requireRole('student', 'admin'), (req, res) => {
  const r = releaseStall(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.get('/market/items', (req, res) => {
  const sessionId = Number(req.query.sessionId) || currentSession()?.id;
  const rows = db.prepare("SELECT i.*, u.nickname AS seller_name, u.avatar AS seller_avatar FROM market_items i JOIN users u ON u.id=i.seller_id WHERE i.session_id=? AND i.status IN ('active','reserved') ORDER BY i.id DESC").all(sessionId);
  res.json(rows.map(mapItem));
});

router.post('/market/items', requireRole('student', 'admin'), (req, res) => {
  const r = createItem(req.user.id, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(201).json({ itemId: r.itemId });
});

router.post('/market/items/:id/list', requireRole('student', 'admin'), (req, res) => {
  const r = listItem(req.user.id, Number(req.params.id), req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/items/:id/remove', requireRole('student', 'admin'), (req, res) => {
  const r = removeItem(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/items/:id/buy', requireRole('student', 'admin'), (req, res) => {
  const r = buyItem(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, code: r.code });
  res.json(r);
});

router.post('/market/items/:id/bargains', requireRole('student', 'admin'), (req, res) => {
  const r = createBargain(req.user.id, Number(req.params.id), req.body?.offerCoin);
  if (r.error) return res.status(r.status).json({ error: r.error, code: r.code });
  res.json(r);
});

router.post('/market/bargains/:id/accept', requireRole('student', 'admin'), (req, res) => {
  const r = acceptBargain(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, code: r.code });
  res.json(r);
});

router.post('/market/bargains/:id/reject', requireRole('student', 'admin'), (req, res) => {
  const r = rejectBargain(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/orders/:id/pay', requireRole('student', 'admin'), (req, res) => {
  const r = payOrder(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/orders/:id/deliver', requireRole('student', 'admin'), (req, res) => {
  const r = deliverOrder(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/orders/:id/confirm', requireRole('student', 'admin'), (req, res) => {
  const r = confirmOrder(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/orders/:id/cancel', requireRole('student', 'admin'), (req, res) => {
  const r = cancelOrder(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/orders/:id/open', requireRole('student', 'admin'), (req, res) => {
  const r = openBlindbox(req.user.id, Number(req.params.id));
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/orders/:id/rate', requireRole('student', 'admin'), (req, res) => {
  const r = rateOrder(req.user.id, Number(req.params.id), req.body.rating);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.get('/market/disputes/mine', requireRole('student', 'admin'), (req, res) => {
  res.json(listMyDisputes(req.user.id));
});

router.post('/market/disputes', requireRole('student', 'admin'), (req, res) => {
  const r = createDispute(req.user.id, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(201).json(r);
});

router.post('/market/disputes/:id/resolve', requireRole('admin'), (req, res) => {
  const r = resolveDispute(req.user.id, Number(req.params.id), req.body?.outcome);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.get('/market/broadcasts', (req, res) => {
  const sessionId = Number(req.query.sessionId) || currentSession()?.id;
  if (!sessionId) return res.json({ fee: cfg('broadcast_fee') ?? 0, limit: cfg('broadcastPerUserPerSession'), myCount: 0, broadcasts: [] });
  res.json(listBroadcasts(sessionId, req.user.id));
});

router.post('/market/broadcasts', requireRole('student', 'admin'), (req, res) => {
  const r = broadcast(req.user.id, Number(req.body?.sessionId), req.body?.content, req.body?.stallId);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(201).json(r);
});

router.post('/market/shops/:id/bids', requireRole('student', 'admin'), (req, res) => {
  const r = bidShop(req.user.id, Number(req.params.id), req.body?.termWeek, req.body?.amountCoin);
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.json(r);
});

router.post('/market/flash', requireRole('admin'), (req, res) => {
  const r = createFlashSale(req.user.id, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error, ...(r.code ? { code: r.code } : {}) });
  res.status(201).json(r);
});

export default router;
