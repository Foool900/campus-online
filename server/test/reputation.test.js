import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox, createDispute, resolveDispute, grabStall, confirmStall, recomputeReputation, rateOrder, reputeLevel,
} = await import('../routes/market.js');

initDb();

let seq = 0;
function makeUser(coin = 0) {
  seq += 1;
  const info = db
    .prepare("INSERT INTO users (nickname, college, avatar, exp, coin, frozen_coin, role, created_at) VALUES (?, '计算机', '🎓', 0, ?, 0, 'student', ?)")
    .run(`用户${seq}`, coin, nowIso());
  return Number(info.lastInsertRowid);
}
function openSession() {
  const r = createSession(new Date(Date.now() + 3600000).toISOString());
  const sid = r.session.id;
  db.prepare("UPDATE market_sessions SET status='open' WHERE id=?").run(sid);
  return sid;
}
function occupiedStall(uid, sid) {
  const g = grabStall(uid, sid);
  assert.equal(g.error, undefined);
  assert.equal(confirmStall(uid, g.stallId).error, undefined);
  return g.stallId;
}
function eventsOf(userId) {
  return db.prepare('SELECT event FROM market_reputation_events WHERE user_id=? ORDER BY id').all(userId).map((r) => r.event);
}
// 造一个已开盒的盲盒订单，返回 { orderId, sellerId, buyerId }
function openedBlindbox(buyer, seller, sid, stallId) {
  const r = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 100, type: 'blindbox' });
  assert.equal(r.error, undefined);
  assert.equal(listItem(seller, r.itemId, { stallId }).error, undefined);
  const b = buyItem(buyer, r.itemId);
  assert.equal(b.error, undefined);
  assert.equal(openBlindbox(buyer, b.orderId).error, undefined);
  return { orderId: b.orderId, sellerId: seller, buyerId: buyer, itemId: r.itemId };
}

test('Step A: 盲盒开盒写 completion 事件', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const { orderId, sellerId } = openedBlindbox(buyer, seller, sid, stallId);

  assert.ok(eventsOf(sellerId).includes('completion'));
  // 幂等：重复开盒不会重复写（订单已 completed，二次 open 会失败；此处只验事件唯一）
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM market_reputation_events WHERE user_id=? AND order_id=? AND event=?').get(sellerId, orderId, 'completion').c, 1);
});

test('Step A: 纠纷买家胜诉（resolved_buyer）写 dispute_lost 事件', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const admin = makeUser(0);
  const stallId = occupiedStall(seller, sid);
  const { orderId, sellerId, buyerId } = openedBlindbox(buyer, seller, sid, stallId);

  const d = createDispute(buyerId, { orderId, reason: '货不对板' });
  assert.equal(d.error, undefined);
  const disputeId = db.prepare('SELECT id FROM market_disputes WHERE order_id=?').get(orderId).id;

  const r = resolveDispute(admin, disputeId, 'resolved_buyer');
  assert.equal(r.error, undefined);
  assert.ok(eventsOf(sellerId).includes('dispute_lost'));
});

// ---- Step B：聚合计算 helpers ----
function insertItem(sellerId, sid) {
  const info = db.prepare("INSERT INTO market_items (session_id, seller_id, type, title, price_coin, status, created_at) VALUES (?, ?, 'normal', '商品', 100, 'active', ?)").run(sid, sellerId, nowIso());
  return Number(info.lastInsertRowid);
}
function insertOrder(sellerId, itemId, status = 'completed') {
  const buyer = makeUser(0);
  const info = db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, price_coin, fee_coin, status, created_at) VALUES (?, ?, ?, 'normal', 100, 0, ?, ?)").run(itemId, buyer, sellerId, status, nowIso());
  return Number(info.lastInsertRowid);
}
function insertRating(sellerId, orderId, rating) {
  db.prepare("INSERT INTO market_reputation_events (user_id, order_id, event, rating, created_at) VALUES (?, ?, 'rating', ?, ?)").run(sellerId, orderId, rating, nowIso());
}
function insertDisputeLost(sellerId, orderId) {
  db.prepare("INSERT INTO market_reputation_events (user_id, order_id, event, created_at) VALUES (?, ?, 'dispute_lost', ?)").run(sellerId, orderId, nowIso());
}
function repOf(userId) {
  return db.prepare('SELECT * FROM market_reputations WHERE user_id=?').get(userId);
}
// 造 N 个 completed 订单（可选给每个订单打 rating）
function buildOrders(sellerId, n, rating) {
  const sid = openSession();
  const orders = [];
  for (let i = 0; i < n; i++) {
    const itemId = insertItem(sellerId, sid);
    const orderId = insertOrder(sellerId, itemId, 'completed');
    if (rating != null) insertRating(sellerId, orderId, rating);
    orders.push(orderId);
  }
  return orders;
}
function close(actual, expected, eps = 0.001) {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ≈ ${expected}`);
}

test('Step B: 0 单 → new / 70 / good 0.5 / completion 1 / 其余 0', () => {
  const seller = makeUser(0);
  recomputeReputation(seller);
  const r = repOf(seller);
  assert.equal(r.score, 70);
  assert.equal(r.level, 'new');
  assert.equal(r.good_rate, 0.5);
  assert.equal(r.completion_rate, 1);
  assert.equal(r.cancel_rate, 0);
  assert.equal(r.dispute_lost_rate, 0);
  assert.equal(r.order_count, 0);
  assert.equal(r.protected_orders, 5);
});

test('Step B: 5 单全好评 → 79 / regular', () => {
  const seller = makeUser(0);
  buildOrders(seller, 5, 5);
  recomputeReputation(seller);
  const r = repOf(seller);
  assert.equal(r.score, 79);
  assert.equal(r.level, 'regular');
  assert.equal(r.order_count, 5);
  assert.equal(r.protected_orders, 0);
});

test('Step B: 10 单全好评 → 85 / trusted', () => {
  const seller = makeUser(0);
  buildOrders(seller, 10, 5);
  recomputeReputation(seller);
  const r = repOf(seller);
  assert.equal(r.score, 85);
  assert.equal(r.level, 'trusted');
});

test('Step B: 20 单全好评 → 93 / veteran', () => {
  const seller = makeUser(0);
  buildOrders(seller, 20, 5);
  recomputeReputation(seller);
  const r = repOf(seller);
  assert.equal(r.score, 93);
  assert.equal(r.level, 'veteran');
});

test('Step B: 40 单全好评 → 100 / veteran', () => {
  const seller = makeUser(0);
  buildOrders(seller, 40, 5);
  recomputeReputation(seller);
  const r = repOf(seller);
  assert.equal(r.score, 100);
  assert.equal(r.level, 'veteran');
});

test('Step B: 5 单全差评（rating=1）→ 66 / regular', () => {
  const seller = makeUser(0);
  buildOrders(seller, 5, 1);
  recomputeReputation(seller);
  const r = repOf(seller);
  assert.equal(r.score, 66);
  assert.equal(r.level, 'regular');
});

test('Step B: risky（10 completed + 5 rating=1 + 2 dispute_lost）→ 58 / risky', () => {
  const seller = makeUser(0);
  const orders = buildOrders(seller, 10, null);
  for (let i = 0; i < 5; i++) insertRating(seller, orders[i], 1);
  for (let i = 0; i < 2; i++) insertDisputeLost(seller, orders[i + 5]);
  recomputeReputation(seller);
  const r = repOf(seller);
  close(r.good_rate, 0.333);
  close(r.dispute_lost_rate, 0.2);
  assert.equal(r.score, 58);
  assert.equal(r.level, 'risky');
});

// ---- Step C：rate 接口 helpers ----
function mkOrder(sellerId, { status = 'completed', completedAt = nowIso() } = {}) {
  const sid = openSession();
  const itemId = insertItem(sellerId, sid);
  const buyerId = makeUser(0);
  const info = db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, price_coin, fee_coin, status, completed_at, created_at) VALUES (?, ?, ?, 'normal', 100, 0, ?, ?, ?)")
    .run(itemId, buyerId, sellerId, status, completedAt, nowIso());
  return { orderId: Number(info.lastInsertRowid), sellerId, buyerId };
}
function ratingCount(sellerId, orderId) {
  return db.prepare("SELECT COUNT(*) AS c FROM market_reputation_events WHERE user_id=? AND order_id=? AND event='rating'").get(sellerId, orderId).c;
}

test('Step C: 正常评价 → 写 1 条 rating 事件 + good_rate 变化', () => {
  const seller = makeUser(0);
  const { orderId, buyerId } = mkOrder(seller);
  const r = rateOrder(buyerId, orderId, 5);
  assert.equal(r.ok, true);
  assert.equal(ratingCount(seller, orderId), 1);
  // 0 评价 good_rate=0.5 → 1 条 5 星后 (1+5)/(1+10)=6/11
  close(repOf(seller).good_rate, 6 / 11);
});

test('Step C: 重复评价 → 409 ALREADY_RATED，事件仍 1 条，reputations 不变', () => {
  const seller = makeUser(0);
  const { orderId, buyerId } = mkOrder(seller);
  assert.equal(rateOrder(buyerId, orderId, 5).ok, true);
  const before = repOf(seller);
  const r2 = rateOrder(buyerId, orderId, 4);
  assert.equal(r2.code, 'ALREADY_RATED');
  assert.equal(r2.status, 409);
  assert.equal(ratingCount(seller, orderId), 1);
  assert.equal(repOf(seller).good_rate, before.good_rate);
});

test('Step C: 超 30 天 → 400 RATE_WINDOW_EXPIRED', () => {
  const seller = makeUser(0);
  const past = new Date(Date.now() - 31 * 86400000).toISOString();
  const { orderId, buyerId } = mkOrder(seller, { completedAt: past });
  const r = rateOrder(buyerId, orderId, 5);
  assert.equal(r.code, 'RATE_WINDOW_EXPIRED');
  assert.equal(r.status, 400);
});

test('Step C: 非买家评价 → 403 NOT_BUYER', () => {
  const seller = makeUser(0);
  const { orderId } = mkOrder(seller);
  const other = makeUser(0);
  const r = rateOrder(other, orderId, 5);
  assert.equal(r.code, 'NOT_BUYER');
  assert.equal(r.status, 403);
});

test('Step C: 订单未完成（paid_escrow）→ 400 ORDER_NOT_COMPLETED', () => {
  const seller = makeUser(0);
  const { orderId, buyerId } = mkOrder(seller, { status: 'paid_escrow' });
  const r = rateOrder(buyerId, orderId, 5);
  assert.equal(r.code, 'ORDER_NOT_COMPLETED');
  assert.equal(r.status, 400);
});

test('Step C: rating 非法（0/6/1.5/"3"）→ 400 INVALID_RATING', () => {
  const seller = makeUser(0);
  const { orderId, buyerId } = mkOrder(seller);
  for (const bad of [0, 6, 1.5, '3']) {
    const r = rateOrder(buyerId, orderId, bad);
    assert.equal(r.code, 'INVALID_RATING', `rating=${bad} 应被拒绝`);
    assert.equal(r.status, 400);
  }
  assert.equal(ratingCount(seller, orderId), 0);
});

// ---- Step D：边界 ----
test('Step D: 保护期回溯 — 前 5 单好评 + 第 6 单差评，good_rate 用全历史 6 单算', () => {
  const seller = makeUser(0);
  buildOrders(seller, 5, 5); // 前 5 单全好评
  buildOrders(seller, 1, 1); // 第 6 单差评
  recomputeReputation(seller);
  const r = repOf(seller);
  // 全历史回溯：(5+5)/(6+10)=0.625；若只算第 6 单会是 5/11≈0.455
  close(r.good_rate, 0.625);
  assert.equal(r.order_count, 6);
  assert.equal(r.score, 78);
  assert.equal(r.level, 'regular');
});

test('Step D: level 边界（79/80/89/90 + 量级门槛）', () => {
  assert.equal(reputeLevel(5, 79), 'regular');
  assert.equal(reputeLevel(5, 80), 'trusted');
  assert.equal(reputeLevel(5, 89), 'trusted');
  assert.equal(reputeLevel(10, 90), 'trusted'); // score≥90 但 order_count<20 → 非 veteran
  assert.equal(reputeLevel(20, 90), 'veteran'); // score≥90 且 order_count≥20
  assert.equal(reputeLevel(4, 90), 'new');      // new 优先级最高
  assert.equal(reputeLevel(5, 59), 'risky');    // <60 兜底
});

test('Step D: 删除卖家 → market_reputations 行被 ON DELETE CASCADE 删除', () => {
  const seller = makeUser(0);
  recomputeReputation(seller);
  assert.ok(repOf(seller));
  db.prepare('DELETE FROM users WHERE id=?').run(seller);
  assert.equal(repOf(seller), undefined);
});
