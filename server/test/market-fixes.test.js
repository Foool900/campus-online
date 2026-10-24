import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { systemAccountId } = await import('../treasury.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox, createDispute, resolveDispute,
  grabStall, confirmStall, expireReservedStalls, recomputeReputation,
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
function acct(id) {
  return db.prepare('SELECT coin, frozen_coin AS frozenCoin FROM users WHERE id=?').get(id);
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
  const c = confirmStall(uid, g.stallId);
  assert.equal(c.error, undefined);
  return g.stallId;
}
const past = () => new Date(Date.now() - 60000).toISOString();
const future = () => new Date(Date.now() + 60000).toISOString();

test('盲盒纠纷胜诉：保证金全额处理（保底赔买家，剩余没收进奖池，不冻结残留）', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const admin = makeUser(0);
  const stallId = occupiedStall(seller, sid); // 冻结押金 5

  const item = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 100, type: 'blindbox' });
  assert.equal(item.error, undefined);
  assert.equal(listItem(seller, item.itemId, { stallId }).error, undefined); // 冻结保证金 80
  const bc = db.prepare('SELECT deposit_coin, min_value_coin FROM market_blindbox_configs WHERE item_id=?').get(item.itemId);

  const b = buyItem(buyer, item.itemId);
  assert.equal(b.error, undefined);
  assert.equal(openBlindbox(buyer, b.orderId).error, undefined); // 开盒即成交

  const sysBefore = acct(systemAccountId()).coin;
  assert.equal(createDispute(buyer, { orderId: b.orderId, reason: '货不对板' }).error, undefined);
  const disputeId = db.prepare('SELECT id FROM market_disputes WHERE order_id=?').get(b.orderId).id;

  assert.equal(resolveDispute(admin, disputeId, 'resolved_buyer').error, undefined);

  // 卖家只剩地摊押金 5：盲盒保证金 80 全额处理，不再永久冻结残留
  assert.equal(acct(seller).frozenCoin, 5);
  // 剩余保证金（80 - 10）进奖池
  assert.equal(acct(systemAccountId()).coin, sysBefore + (bc.deposit_coin - bc.min_value_coin));
  // 买家获赔保底 10
  assert.equal(acct(buyer).coin, 910);
});

test('预留摊位 15min 超时释放：退回 available + 清空 owner，占坑者可重新抢', () => {
  const sid = openSession();
  const seller = makeUser(1000);

  const g = grabStall(seller, sid);
  assert.equal(g.error, undefined);
  const stallId = g.stallId;
  assert.equal(db.prepare('SELECT status FROM market_stalls WHERE id=?').get(stallId).status, 'reserved');

  // 模拟 15min 未确认超时
  db.prepare('UPDATE market_stalls SET reserved_expires_at=? WHERE id=?').run(past(), stallId);

  const r1 = expireReservedStalls(future());
  assert.equal(r1.released, 1);
  const stall = db.prepare('SELECT status, owner_id FROM market_stalls WHERE id=?').get(stallId);
  assert.equal(stall.status, 'available');
  assert.equal(stall.owner_id, null);

  // 占坑者被释放后可重新抢摊（同时验证 idempotency_key 已清空，不撞唯一键）
  const g2 = grabStall(seller, sid);
  assert.equal(g2.error, undefined);

  // 幂等：再扫不重复
  const r2 = expireReservedStalls(future());
  assert.equal(r2.released, 0);
});

test('买家爽约（cancelled 订单）不计入卖家 cancelRate / 不扣分', () => {
  const seller = makeUser(0);
  const sid = openSession();

  // 5 单 completed 全好评 → 基线 79
  for (let i = 0; i < 5; i++) {
    const itemId = db.prepare("INSERT INTO market_items (session_id, seller_id, type, title, price_coin, status, created_at) VALUES (?, ?, 'normal', '商品', 100, 'active', ?)").run(sid, seller, nowIso()).lastInsertRowid;
    const buyer = makeUser(0);
    const orderId = db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, price_coin, fee_coin, status, created_at) VALUES (?, ?, ?, 'normal', 100, 0, 'completed', ?)").run(itemId, buyer, seller, nowIso()).lastInsertRowid;
    db.prepare("INSERT INTO market_reputation_events (user_id, order_id, event, rating, created_at) VALUES (?, ?, 'rating', 5, ?)").run(seller, orderId, nowIso());
  }
  // 再加 2 单「买家爽约」cancelled
  for (let i = 0; i < 2; i++) {
    const itemId = db.prepare("INSERT INTO market_items (session_id, seller_id, type, title, price_coin, status, created_at) VALUES (?, ?, 'normal', '商品', 100, 'active', ?)").run(sid, seller, nowIso()).lastInsertRowid;
    const buyer = makeUser(0);
    db.prepare("INSERT INTO market_orders (item_id, buyer_id, seller_id, type, price_coin, fee_coin, status, created_at) VALUES (?, ?, ?, 'normal', 100, 0, 'cancelled', ?)").run(itemId, buyer, seller, nowIso());
  }

  recomputeReputation(seller);
  const r = db.prepare('SELECT * FROM market_reputations WHERE user_id=?').get(seller);
  assert.equal(r.cancel_rate, 0);
  assert.equal(r.completion_rate, 1);
  assert.equal(r.score, 79); // 与 5 单全好评基线一致，未因 cancelled 扣分
  assert.equal(r.level, 'regular');
});

test('多库存商品售罄立即标记 sold（不再显示在售）', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);

  const item = createItem(seller, { sessionId: sid, title: '多件', priceCoin: 50, stock: 2 });
  assert.equal(item.error, undefined);
  assert.equal(listItem(seller, item.itemId, { stallId }).error, undefined);

  assert.equal(buyItem(buyer, item.itemId).error, undefined);
  assert.equal(db.prepare('SELECT status FROM market_items WHERE id=?').get(item.itemId).status, 'active'); // 还剩 1 件

  assert.equal(buyItem(buyer, item.itemId).error, undefined);
  assert.equal(db.prepare('SELECT status FROM market_items WHERE id=?').get(item.itemId).status, 'sold'); // 售罄立即 sold
});
