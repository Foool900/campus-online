import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  createSession, createItem, listItem, buyItem, openBlindbox,
  createBargain, acceptBargain, grabStall, confirmStall, ensureMarketShops, bidShop,
  expireStalls, expireBargainPayments, releaseBlindboxHolds, settleDueShopTerms,
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
const past = () => new Date(Date.now() - 60000).toISOString();
const future = () => new Date(Date.now() + 60000).toISOString();

test('地摊到期释放：商品过期 + 押金退款，幂等不重复', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const stallId = occupiedStall(seller, sid); // 冻结 5 押金
  const itemId = listedItem(seller, sid, stallId, { price: 100 });
  assert.equal(acct(seller).frozenCoin, 5);

  db.prepare('UPDATE market_stalls SET expires_at=? WHERE id=?').run(past(), stallId);

  const r1 = expireStalls(future());
  assert.equal(r1.released, 1);
  assert.equal(db.prepare('SELECT status FROM market_stalls WHERE id=?').get(stallId).status, 'released');
  assert.equal(db.prepare('SELECT status FROM market_items WHERE id=?').get(itemId).status, 'expired');
  assert.equal(acct(seller).frozenCoin, 0); // 押金已退

  const r2 = expireStalls(future());
  assert.equal(r2.released, 0); // 第二次不重复
  assert.equal(acct(seller).frozenCoin, 0);
});

test('砍价支付超时：订单取消 + 冻结退款 + 商品回 active，幂等不重复', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const br = createBargain(buyer, itemId, 60);
  const ar = acceptBargain(seller, br.bargainId); // pending_payment 订单
  assert.equal(acct(buyer).frozenCoin, 60);

  db.prepare('UPDATE market_orders SET pay_deadline_at=? WHERE id=?').run(past(), ar.orderId);

  const r1 = expireBargainPayments(future());
  assert.equal(r1.cancelled, 1);
  assert.equal(db.prepare('SELECT status FROM market_orders WHERE id=?').get(ar.orderId).status, 'cancelled');
  assert.equal(db.prepare('SELECT status FROM market_items WHERE id=?').get(itemId).status, 'active');
  assert.equal(acct(buyer).frozenCoin, 0); // 退款

  const r2 = expireBargainPayments(future());
  assert.equal(r2.cancelled, 0);
  assert.equal(acct(buyer).frozenCoin, 0);
});

test('盲盒保证金 24h 后释放：held→released + 保证金退款，幂等不重复', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid); // 冻结 5 押金

  const item = createItem(seller, { sessionId: sid, title: '盲盒', priceCoin: 100, type: 'blindbox' });
  listItem(seller, item.itemId, { stallId }); // 冻结保证金 80
  const deposit = db.prepare('SELECT deposit_coin FROM market_blindbox_configs WHERE item_id=?').get(item.itemId).deposit_coin;
  const beforeFrozen = acct(seller).frozenCoin; // 5 + 80 = 85

  const b = buyItem(buyer, item.itemId);
  openBlindbox(buyer, b.orderId); // config → held

  db.prepare('UPDATE market_blindbox_configs SET hold_until=? WHERE item_id=?').run(past(), item.itemId);

  const r1 = releaseBlindboxHolds(future());
  assert.equal(r1.released, 1);
  assert.equal(db.prepare('SELECT status FROM market_blindbox_configs WHERE item_id=?').get(item.itemId).status, 'released');
  assert.equal(acct(seller).frozenCoin, beforeFrozen - deposit); // 退保证金（剩 5 押金）

  const r2 = releaseBlindboxHolds(future());
  assert.equal(r2.released, 0);
  assert.equal(acct(seller).frozenCoin, beforeFrozen - deposit);
});

test('店铺竞拍结算：中标付租、未中标退款，幂等不重复', () => {
  ensureMarketShops();
  const shop = db.prepare('SELECT * FROM market_shops ORDER BY id LIMIT 1').get();
  const termWeek = '2026-W01';
  const winner = makeUser(1000);
  const loser = makeUser(1000);

  bidShop(winner, shop.id, termWeek, 200);
  bidShop(loser, shop.id, termWeek, 100);
  assert.equal(acct(winner).frozenCoin, 200);
  assert.equal(acct(loser).frozenCoin, 100);

  db.prepare('UPDATE market_shop_bids SET deadline_at=? WHERE term_week=?').run(past(), termWeek);

  const r1 = settleDueShopTerms(future());
  assert.deepEqual(r1.settled, [termWeek]);
  assert.equal(acct(winner).frozenCoin, 0); // 冻结全额转租金
  assert.equal(acct(loser).frozenCoin, 0);  // 未中标全额退
  assert.equal(db.prepare('SELECT owner_id FROM market_shop_terms WHERE shop_id=? AND term_week=?').get(shop.id, termWeek).owner_id, winner);

  const r2 = settleDueShopTerms(future());
  assert.deepEqual(r2.settled, []); // 第二次无待结算
  assert.equal(acct(winner).frozenCoin, 0);
  assert.equal(acct(loser).frozenCoin, 0);
});
