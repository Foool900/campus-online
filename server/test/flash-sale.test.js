import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const { systemAccountId } = await import('../treasury.js');
const {
  createSession, createItem, listItem, buyItem, createFlashSale, grabStall, confirmStall,
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
  assert.equal(confirmStall(uid, g.stallId).error, undefined);
  return g.stallId;
}
function listedItem(seller, sid, stallId, opts = {}) {
  const r = createItem(seller, { sessionId: sid, title: opts.title || '商品', priceCoin: opts.price ?? 100, type: opts.type || 'normal' });
  assert.equal(r.error, undefined);
  assert.equal(listItem(seller, r.itemId, { stallId }).error, undefined);
  return r.itemId;
}

test('官方秒杀：买家付 price，SYSTEM 收 price，两条 ledger，订单 completed', () => {
  const sid = openSession();
  const admin = makeUser(0);
  const buyer = makeUser(1000);
  const sysId = systemAccountId();
  const item = createFlashSale(admin, { sessionId: sid, title: '秒杀', priceCoin: 60, costCoin: 100, stock: 1 });

  const r = buyItem(buyer, item.itemId);
  assert.equal(r.error, undefined);

  assert.equal(db.prepare('SELECT status FROM market_orders WHERE id=?').get(r.orderId).status, 'completed');
  assert.equal(db.prepare('SELECT type FROM market_orders WHERE id=?').get(r.orderId).type, 'official_flash_sale');
  assert.equal(acct(buyer).coin, 1000 - 60);
  assert.equal(db.prepare('SELECT coin FROM users WHERE id=?').get(sysId).coin, 60);

  const inRow = db.prepare("SELECT * FROM market_ledger WHERE biz_type='flash_sale_sale'").get();
  assert.equal(inRow.op, 'treasury_in');
  assert.equal(inRow.amount, 60);
  assert.ok(inRow.coin_tx_id != null); // 有 coin_tx_id

  const budgetRow = db.prepare("SELECT * FROM market_ledger WHERE biz_type='flash_sale_subsidy'").get();
  assert.equal(budgetRow.op, 'budget_spend');
  assert.equal(budgetRow.amount, 40);
  assert.equal(budgetRow.coin_tx_id, null); // 账面指标，无金币
});

test('官方秒杀：超预算被拦，整体回滚（库存/余额/ledger 不变）', () => {
  const sid = openSession();
  const admin = makeUser(0);
  const buyer = makeUser(1000);
  const item = createFlashSale(admin, { sessionId: sid, title: '秒杀', priceCoin: 60, costCoin: 100, stock: 2 });
  db.prepare("INSERT INTO market_configs (key, value, updated_at) VALUES ('flashSaleBudget', '40', ?)").run(nowIso());

  assert.equal(buyItem(buyer, item.itemId).error, undefined); // 补贴 40，刚好用满

  const beforeCoin = acct(buyer).coin;
  const beforeLedger = db.prepare("SELECT COUNT(*) AS c FROM market_ledger").get().c;
  const r2 = buyItem(buyer, item.itemId);
  assert.equal(r2.code, 'FLASH_SALE_BUDGET_EXCEEDED');
  assert.equal(db.prepare('SELECT sold_count FROM market_items WHERE id=?').get(item.itemId).sold_count, 1); // 库存回滚
  assert.equal(acct(buyer).coin, beforeCoin); // 余额不变
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM market_ledger").get().c, beforeLedger); // ledger 不变
});

test('官方秒杀：买家余额不足，COIN_INSUFFICIENT 且库存回滚', () => {
  const sid = openSession();
  const admin = makeUser(0);
  const buyer = makeUser(50); // 50 < 60
  const item = createFlashSale(admin, { sessionId: sid, title: '秒杀', priceCoin: 60, costCoin: 100, stock: 1 });

  const r = buyItem(buyer, item.itemId);
  assert.equal(r.code, 'COIN_INSUFFICIENT');
  assert.equal(db.prepare('SELECT sold_count FROM market_items WHERE id=?').get(item.itemId).sold_count, 0); // 库存回滚
});

test('普通商品：不触发 flash_sale_subsidy 流水，仍走 escrow', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const before = db.prepare("SELECT COUNT(*) AS c FROM market_ledger WHERE biz_type='flash_sale_subsidy'").get().c;
  const b = buyItem(buyer, itemId);
  assert.equal(b.error, undefined);
  assert.equal(db.prepare('SELECT status FROM market_orders WHERE id=?').get(b.orderId).status, 'paid_escrow'); // 走 escrow
  assert.equal(db.prepare("SELECT COUNT(*) AS c FROM market_ledger WHERE biz_type='flash_sale_subsidy'").get().c, before); // 无补贴流水
});
