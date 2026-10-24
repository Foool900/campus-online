import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { systemAccountId } = await import('../treasury.js');
const {
  createSession, createItem, listItem, buyItem, confirmOrder,
  createBargain, acceptBargain, payOrder, grabStall, confirmStall,
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
function listedItem(seller, sid, stallId, opts = {}) {
  const r = createItem(seller, { sessionId: sid, title: opts.title || '商品', priceCoin: opts.price ?? 100, type: opts.type || 'normal' });
  assert.equal(r.error, undefined);
  const l = listItem(seller, r.itemId, { stallId });
  assert.equal(l.error, undefined);
  return r.itemId;
}

test('正常购买：冻结付款 → 确认划账 + 手续费进 SYSTEM', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const fee = Math.floor(100 * config.coin.tradeFeeRate);
  const sysBefore = db.prepare('SELECT coin FROM users WHERE id=?').get(systemAccountId()).coin;

  const b = buyItem(buyer, itemId);
  assert.equal(b.error, undefined);
  assert.equal(acct(buyer).frozenCoin, 100); // 付款已冻结

  const c = confirmOrder(buyer, b.orderId);
  assert.equal(c.error, undefined);
  assert.equal(acct(buyer).frozenCoin, 0);
  assert.equal(acct(seller).coin, 1000 - 5 + (100 - fee)); // 扣 5 押金冻结 + 收净额
  assert.equal(db.prepare('SELECT coin FROM users WHERE id=?').get(systemAccountId()).coin, sysBefore + fee);
});

test('砍价：出价冻结 → 接受生成订单 → 支付不重复冻结 → 确认', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const br = createBargain(buyer, itemId, 60);
  assert.equal(br.error, undefined);
  assert.equal(acct(buyer).frozenCoin, 60); // 出价冻结

  const ar = acceptBargain(seller, br.bargainId);
  assert.equal(ar.error, undefined);

  const pr = payOrder(buyer, ar.orderId);
  assert.equal(pr.error, undefined);
  assert.equal(acct(buyer).frozenCoin, 60); // 不重复冻结

  const fee = Math.floor(60 * config.coin.tradeFeeRate);
  const c = confirmOrder(buyer, ar.orderId);
  assert.equal(c.error, undefined);
  assert.equal(acct(buyer).frozenCoin, 0);
  assert.equal(acct(seller).coin, 1000 - 5 + (60 - fee));
});

test('购买自己的商品被拒绝', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 50 });
  const r = buyItem(seller, itemId);
  assert.equal(r.status, 400);
});

test('盲盒上架保证金不足：listItem 返回 code=COIN_INSUFFICIENT', () => {
  const sid = openSession();
  const seller = makeUser(10); // 抢摊冻结押金 5 后，可冻结余额剩 5
  const stallId = occupiedStall(seller, sid);
  assert.equal(acct(seller).coin, 5);

  const c = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 10, type: 'blindbox' });
  assert.equal(c.error, undefined);

  // 保证金 = floor(10 * 0.8) = 8 > 5，冻结失败
  const l = listItem(seller, c.itemId, { stallId });
  assert.equal(l.error, '金币不足');
  assert.equal(l.code, 'COIN_INSUFFICIENT');
  assert.equal(l.status, 400);
});
