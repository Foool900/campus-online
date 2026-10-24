import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox, createDispute, grabStall, confirmStall, listMyDisputes,
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
function openedBlindboxOrder(buyer, seller, sid, stallId) {
  const r = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 100, type: 'blindbox' });
  assert.equal(r.error, undefined);
  assert.equal(listItem(seller, r.itemId, { stallId }).error, undefined);
  const b = buyItem(buyer, r.itemId);
  assert.equal(b.error, undefined);
  assert.equal(openBlindbox(buyer, b.orderId).error, undefined);
  return b.orderId;
}

test('listMyDisputes: reportable 只含开盒 24h 内且未举报的盲盒，deadlineAt = opened_at + holdHours', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);

  const o1 = openedBlindboxOrder(buyer, seller, sid, stallId); // 开盒 24h 内
  const o2 = openedBlindboxOrder(buyer, seller, sid, stallId); // 稍后改为 25h 前 → 超窗
  db.prepare('UPDATE market_blindbox_opens SET opened_at=? WHERE order_id=?')
    .run(new Date(Date.now() - 25 * 3600000).toISOString(), o2);

  let r = listMyDisputes(buyer);
  assert.equal(r.limit, config.market.reportMonthlyLimit);
  assert.equal(r.used, 0);
  assert.equal(r.remaining, config.market.reportMonthlyLimit);
  assert.deepEqual(r.reportable.map((x) => x.orderId), [o1]); // o2 超窗被过滤

  // deadlineAt 与 createDispute 同公式（opened_at + blindboxHoldHours）
  const openedAt = db.prepare('SELECT opened_at FROM market_blindbox_opens WHERE order_id=?').get(o1).opened_at;
  const expected = new Date(new Date(openedAt).getTime() + config.market.blindboxHoldHours * 3600000).toISOString();
  assert.equal(r.reportable[0].deadlineAt, expected);
  assert.equal(typeof r.reportable[0].valueCoin, 'number'); // opened_value_coin 已透传
});

test('listMyDisputes: 举报后 order 离开 reportable，used/remaining 更新，历史出现', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);

  const o1 = openedBlindboxOrder(buyer, seller, sid, stallId);
  assert.equal(createDispute(buyer, { orderId: o1, reason: '货不对板' }).error, undefined);

  const r = listMyDisputes(buyer);
  assert.equal(r.used, 1);
  assert.equal(r.remaining, config.market.reportMonthlyLimit - 1);
  assert.deepEqual(r.reportable, []); // 已举报订单不再出现
  assert.equal(r.disputes.length, 1);
  assert.equal(r.disputes[0].orderId, o1);
  assert.equal(r.disputes[0].reason, '货不对板');
  assert.equal(r.disputes[0].status, 'pending');
});
