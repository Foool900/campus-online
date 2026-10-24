import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox, createDispute, resolveDispute, grabStall, confirmStall,
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
