import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { config } = await import('../config.js');
const { systemAccountId } = await import('../treasury.js');
const { createSession, createItem, listItem, buyItem, confirmOrder, grabStall, confirmStall } = await import('../routes/market.js');

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
function sysCoin() {
  return db.prepare('SELECT coin FROM users WHERE id=?').get(systemAccountId()).coin;
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
function listedItem(seller, sid, stallId, opts = {}) {
  const r = createItem(seller, { sessionId: sid, title: opts.title || '商品', priceCoin: opts.price ?? 100, type: opts.type || 'normal' });
  assert.equal(r.error, undefined);
  assert.equal(listItem(seller, r.itemId, { stallId }).error, undefined);
  return r.itemId;
}

test('手续费迁移：买家 −price、卖家 +(price−fee)、SYSTEM +fee（三方守恒）', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid); // 冻结 5 押金
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const fee = Math.floor(100 * config.coin.tradeFeeRate);
  const sellerCoinBefore = acct(seller).coin; // 995
  const sysBefore = sysCoin();

  const b = buyItem(buyer, itemId);
  assert.equal(confirmOrder(buyer, b.orderId).error, undefined);

  assert.equal(acct(buyer).coin, 1000 - 100); // 买家 -100
  assert.equal(acct(seller).coin, sellerCoinBefore + (100 - fee)); // 卖家 +净额
  assert.equal(sysCoin(), sysBefore + fee); // SYSTEM +fee
});

test('重复结算：同一订单 confirmOrder 两次，三方余额不变', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const b = buyItem(buyer, itemId);
  assert.equal(confirmOrder(buyer, b.orderId).error, undefined);

  const buyerCoin = acct(buyer).coin;
  const sellerCoin = acct(seller).coin;
  const sysC = sysCoin();

  const r2 = confirmOrder(buyer, b.orderId);
  assert.equal(r2.status, 409); // 已 completed，被状态守卫拦截
  assert.equal(acct(buyer).coin, buyerCoin);
  assert.equal(acct(seller).coin, sellerCoin);
  assert.equal(sysCoin(), sysC);
});

test('事务回滚：手续费 ledger 写入失败，货款+手续费全部回滚', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });
  const sysId = systemAccountId();

  const b = buyItem(buyer, itemId);
  // 预置一条冲突的 ledger 幂等键，让 confirmOrder 里手续费的 writeLedger 抛 UNIQUE 失败
  db.prepare("INSERT INTO market_ledger (session_id, biz_type, biz_id, op, user_id, counterparty_id, amount, coin_tx_id, idempotency_key, created_at) VALUES (?, 'fee_treasury', ?, 'treasury_in', ?, ?, ?, NULL, ?, ?)")
    .run(sid, b.orderId, buyer, sysId, Math.floor(100 * config.coin.tradeFeeRate), `fee_treasury:${b.orderId}:ledger`, nowIso());

  const buyerCoin = acct(buyer).coin;
  const sellerCoin = acct(seller).coin;
  const sysC = sysCoin();

  const r = confirmOrder(buyer, b.orderId);
  assert.equal(r.code, 'SQLITE_CONSTRAINT_UNIQUE'); // ledger 唯一冲突
  assert.equal(db.prepare('SELECT status FROM market_orders WHERE id=?').get(b.orderId).status, 'paid_escrow'); // 订单未完成
  assert.equal(acct(buyer).coin, buyerCoin); // 全部回滚
  assert.equal(acct(seller).coin, sellerCoin);
  assert.equal(sysCoin(), sysC);
});
