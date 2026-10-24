import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';

const { db, initDb, nowIso } = await import('../db.js');
const {
  createSession, createItem, listItem, createBargain, acceptBargain,
  grabStall, confirmStall, listSellerBargains,
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

test('有 pending 砍价：返回字段齐全', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { title: '二手书', price: 100 });

  const br = createBargain(buyer, itemId, 60);
  assert.equal(br.error, undefined);

  const list = listSellerBargains(seller);
  assert.equal(list.length, 1);
  const b = list[0];
  const buyerName = db.prepare('SELECT nickname FROM users WHERE id=?').get(buyer).nickname;
  assert.equal(b.itemId, itemId);
  assert.equal(b.itemTitle, '二手书');
  assert.equal(b.itemPrice, 100);
  assert.equal(b.buyerId, buyer);
  assert.equal(b.buyerName, buyerName);
  assert.equal(b.buyerAvatar, '🎓');
  assert.equal(b.offerCoin, 60);
  assert.equal(b.attemptNo, 1);
  assert.equal(b.status, 'pending');
  assert.ok(b.createdAt);
  assert.equal(b.expiresAt, null);
});

test('无 pending 砍价：返回空数组', () => {
  const seller = makeUser(1000);
  assert.deepEqual(listSellerBargains(seller), []);
});

test('只返回自己作为卖家的 pending（卖家隔离）', () => {
  const sid = openSession();
  const sellerA = makeUser(1000);
  const sellerB = makeUser(1000);
  const buyer = makeUser(1000);
  const stallA = occupiedStall(sellerA, sid);
  const stallB = occupiedStall(sellerB, sid);
  const itemA = listedItem(sellerA, sid, stallA, { title: 'A货', price: 100 });
  const itemB = listedItem(sellerB, sid, stallB, { title: 'B货', price: 100 });

  assert.equal(createBargain(buyer, itemA, 50).error, undefined);
  assert.equal(createBargain(buyer, itemB, 50).error, undefined);

  const listA = listSellerBargains(sellerA);
  assert.equal(listA.length, 1);
  assert.equal(listA[0].itemId, itemA);
  assert.equal(listA[0].itemTitle, 'A货');

  const listB = listSellerBargains(sellerB);
  assert.equal(listB.length, 1);
  assert.equal(listB[0].itemId, itemB);
});

test('接受后不再出现在 pending 列表', () => {
  const sid = openSession();
  const seller = makeUser(1000);
  const buyer = makeUser(1000);
  const stallId = occupiedStall(seller, sid);
  const itemId = listedItem(seller, sid, stallId, { price: 100 });

  const br = createBargain(buyer, itemId, 60);
  assert.equal(acceptBargain(seller, br.bargainId).error, undefined);

  assert.deepEqual(listSellerBargains(seller), []);
});
